import type { SheetAdapter } from './sheet-adapter';
import type { LockAdapter } from './lock-adapter.ts';

export interface SeederContext {
  adapter: SheetAdapter;
  lock: LockAdapter;
  now: () => Date;
}

export interface SeederReport {
  created: number;
  existing: number;
}

export interface Seeder {
  name: string;
  run(ctx: SeederContext): SeederReport;
}

export function runSeeders(seeders: Seeder[], ctx: SeederContext): Array<{ name: string } & SeederReport> {
  return seeders.map((seeder) => ({ name: seeder.name, ...seeder.run(ctx) }));
}
