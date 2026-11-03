import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../../core/testing/in-memory-sheet-adapter.ts';
import { MigrationRunner } from '../../core/migration.ts';
import { noopLock } from '../../core/lock-adapter.ts';
import { migrations } from '../migrations/index.ts';
import { runSeeders } from '../../core/seeder.ts';
import { seeders } from './index.ts';
import { tagsModel } from '../models/tag.model.ts';

function setup() {
  const adapter = new InMemorySheetAdapter();
  new MigrationRunner(migrations, adapter).migrate();
  return adapter;
}

test('seeding tags twice creates nothing new on the second run', () => {
  const adapter = setup();
  const ctx = { adapter, lock: noopLock, now: () => new Date() };

  const first = runSeeders(seeders, ctx);
  const second = runSeeders(seeders, ctx);

  assert.ok(first[0].created > 0);
  assert.deepEqual(second.map((r) => r.created), [0]);
  assert.equal(tagsModel(adapter).all().length, first[0].created);
});
