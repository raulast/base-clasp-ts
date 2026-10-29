import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../../core/testing/in-memory-sheet-adapter.ts';
import { MigrationRunner } from '../../core/migration.ts';
import { migrations } from './index.ts';
import { createUsersMigration } from './001_create_users.ts';

test('app migrations create users with a username column', () => {
  const adapter = new InMemorySheetAdapter();
  new MigrationRunner(migrations, adapter).migrate();

  assert.ok(adapter.getHeaders('users').includes('username'));
});

test('adding username to an already-migrated users sheet keeps existing users', () => {
  const adapter = new InMemorySheetAdapter();
  new MigrationRunner([createUsersMigration], adapter).migrate();
  adapter.appendRow('users', { id: 1, email: 'a@a.com', password: 'x' });

  const applied = new MigrationRunner(migrations, adapter).migrate();

  assert.deepEqual(applied, ['002_add_username_to_users']);
  assert.equal(adapter.getRows('users')[0].email, 'a@a.com');
  assert.ok(adapter.getHeaders('users').includes('username'));
});

test('rolling back removes the username column', () => {
  const adapter = new InMemorySheetAdapter();
  const runner = new MigrationRunner(migrations, adapter);
  runner.migrate();

  assert.deepEqual(runner.rollback(), ['002_add_username_to_users']);
  assert.equal(adapter.getHeaders('users').includes('username'), false);
});
