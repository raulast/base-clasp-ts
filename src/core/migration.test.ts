import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from './testing/in-memory-sheet-adapter.ts';
import { MigrationRunner } from './migration.ts';
import type { Migration } from './migration.ts';

const FIXED_NOW = () => new Date(1700000000000);

const createUsers: Migration = {
  name: '001_create_users',
  up: (schema) => schema.createSheet('users', ['id', 'email']),
  down: (schema) => schema.dropSheet('users'),
};

const createPosts: Migration = {
  name: '002_create_posts',
  up: (schema) => schema.createSheet('posts', ['id', 'title']),
  down: (schema) => schema.dropSheet('posts'),
};

test('migrate runs every pending migration in order and records them', () => {
  const adapter = new InMemorySheetAdapter();
  const runner = new MigrationRunner([createUsers, createPosts], adapter, 'migrations', FIXED_NOW);

  const applied = runner.migrate();

  assert.deepEqual(applied, ['001_create_users', '002_create_posts']);
  assert.equal(adapter.sheetExists('users'), true);
  assert.equal(adapter.sheetExists('posts'), true);
  assert.deepEqual(runner.applied(), ['001_create_users', '002_create_posts']);
});

test('migrate is idempotent: running it again applies nothing new', () => {
  const adapter = new InMemorySheetAdapter();
  const runner = new MigrationRunner([createUsers, createPosts], adapter, 'migrations', FIXED_NOW);

  runner.migrate();
  const second = runner.migrate();

  assert.deepEqual(second, []);
  assert.equal(runner.applied().length, 2);
});

test('migrate only runs newly added pending migrations', () => {
  const adapter = new InMemorySheetAdapter();
  const firstRunner = new MigrationRunner([createUsers], adapter, 'migrations', FIXED_NOW);
  firstRunner.migrate();

  const secondRunner = new MigrationRunner([createUsers, createPosts], adapter, 'migrations', FIXED_NOW);
  const applied = secondRunner.migrate();

  assert.deepEqual(applied, ['002_create_posts']);
  assert.deepEqual(secondRunner.applied(), ['001_create_users', '002_create_posts']);
});

test('rollback undoes the most recently applied migration by default', () => {
  const adapter = new InMemorySheetAdapter();
  const runner = new MigrationRunner([createUsers, createPosts], adapter, 'migrations', FIXED_NOW);
  runner.migrate();

  const rolledBack = runner.rollback();

  assert.deepEqual(rolledBack, ['002_create_posts']);
  assert.equal(adapter.sheetExists('posts'), false);
  assert.equal(adapter.sheetExists('users'), true);
  assert.deepEqual(runner.applied(), ['001_create_users']);
});

test('rollback can undo more than one migration, most recent first', () => {
  const adapter = new InMemorySheetAdapter();
  const runner = new MigrationRunner([createUsers, createPosts], adapter, 'migrations', FIXED_NOW);
  runner.migrate();

  const rolledBack = runner.rollback(2);

  assert.deepEqual(rolledBack, ['002_create_posts', '001_create_users']);
  assert.equal(adapter.sheetExists('users'), false);
  assert.equal(adapter.sheetExists('posts'), false);
  assert.deepEqual(runner.applied(), []);
});
