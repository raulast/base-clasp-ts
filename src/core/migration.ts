import type { SchemaAdapter } from './schema-adapter';
import type { SheetAdapter } from './sheet-adapter';
import { Model } from './model.ts';

export interface Migration {
  name: string;
  up(schema: SchemaAdapter): void;
  down(schema: SchemaAdapter): void;
}

type Adapter = SheetAdapter & SchemaAdapter;

/**
 * Tracks applied migrations in a regular sheet (via Model), so "what already
 * ran" survives across pushes without any extra storage mechanism.
 */
export class MigrationRunner {
  private readonly migrations: Migration[];
  private readonly adapter: Adapter;
  private readonly tracking: Model;

  constructor(
    migrations: Migration[],
    adapter: Adapter,
    trackingSheet = 'migrations',
    now: () => Date = () => new Date(),
  ) {
    this.migrations = migrations;
    this.adapter = adapter;
    if (!adapter.sheetExists(trackingSheet)) {
      adapter.createSheet(trackingSheet, ['id', 'name', 'migrated_at']);
    }
    this.tracking = new Model(trackingSheet, adapter, now);
  }

  applied(): string[] {
    return this.tracking.all().map((row) => String(row.name));
  }

  migrate(): string[] {
    const already = new Set(this.applied());
    const pending = this.migrations.filter((migration) => !already.has(migration.name));
    for (const migration of pending) {
      migration.up(this.adapter);
      this.tracking.create({ name: migration.name });
    }
    return pending.map((migration) => migration.name);
  }

  rollback(steps = 1): string[] {
    const appliedRows = this.tracking.all().slice(-steps).reverse();
    const rolledBack: string[] = [];
    for (const row of appliedRows) {
      const migration = this.migrations.find((candidate) => candidate.name === row.name);
      if (!migration) continue;
      migration.down(this.adapter);
      this.tracking.delete(row.id as number);
      rolledBack.push(migration.name);
    }
    return rolledBack;
  }
}
