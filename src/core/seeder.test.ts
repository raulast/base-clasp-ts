import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from './testing/in-memory-sheet-adapter.ts';
import { noopLock } from './lock-adapter.ts';
import { Model } from './model.ts';
import { runSeeders } from './seeder.ts';
import type { Seeder } from './seeder.ts';

function setup() {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('things', ['id', 'name', 'created_at', 'updated_at', 'deleted_at']);
  return adapter;
}

function makeSeeder(name: string, adapter: InMemorySheetAdapter): Seeder {
  return {
    name,
    run(ctx) {
      const model = new Model('things', ctx.adapter, ctx.now, ctx.lock);
      let created = 0;
      let existing = 0;
      for (const thingName of ['a', 'b']) {
        const result = model.firstOrCreate({ name: thingName });
        if (result.created) created++;
        else existing++;
      }
      return { created, existing };
    },
  };
}

test('runSeeders reports created rows in order', () => {
  const adapter = setup();
  const ctx = { adapter, lock: noopLock, now: () => new Date() };
  const seeder = makeSeeder('things', adapter);

  const report = runSeeders([seeder], ctx);

  assert.deepEqual(report, [{ name: 'things', created: 2, existing: 0 }]);
});

test('running seeders twice creates nothing new on the second run', () => {
  const adapter = setup();
  const ctx = { adapter, lock: noopLock, now: () => new Date() };
  const seeder = makeSeeder('things', adapter);

  runSeeders([seeder], ctx);
  const secondReport = runSeeders([seeder], ctx);

  assert.deepEqual(secondReport, [{ name: 'things', created: 0, existing: 2 }]);
});
