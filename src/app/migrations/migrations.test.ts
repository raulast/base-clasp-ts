import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../../core/testing/in-memory-sheet-adapter.ts';
import { MigrationRunner } from '../../core/migration.ts';
import { migrations } from './index.ts';
import { createUsersMigration } from './001_create_users.ts';
import { addUsernameToUsersMigration } from './002_add_username_to_users.ts';

test('app migrations create users with a username column', () => {
  const adapter = new InMemorySheetAdapter();
  new MigrationRunner(migrations, adapter).migrate();

  assert.ok(adapter.getHeaders('users').includes('username'));
});

test('adding username to an already-migrated users sheet keeps existing users', () => {
  const adapter = new InMemorySheetAdapter();
  new MigrationRunner([createUsersMigration], adapter).migrate();
  adapter.appendRow('users', { id: 1, email: 'a@a.com', password: 'x' });

  const applied = new MigrationRunner([createUsersMigration, addUsernameToUsersMigration], adapter).migrate();

  assert.deepEqual(applied, ['002_add_username_to_users']);
  assert.equal(adapter.getRows('users')[0].email, 'a@a.com');
  assert.ok(adapter.getHeaders('users').includes('username'));
});

test('rolling back removes the username column', () => {
  const adapter = new InMemorySheetAdapter();
  const runner = new MigrationRunner([migrations[0], migrations[1]], adapter);
  runner.migrate();

  assert.deepEqual(runner.rollback(), ['002_add_username_to_users']);
  assert.equal(adapter.getHeaders('users').includes('username'), false);
});

test('app migrations add role and disabled columns to users', () => {
  const adapter = new InMemorySheetAdapter();
  new MigrationRunner(migrations, adapter).migrate();

  assert.ok(adapter.getHeaders('users').includes('role'));
  assert.ok(adapter.getHeaders('users').includes('disabled'));
});

test('rolling back the role/disabled migration removes both columns and keeps existing users', () => {
  const adapter = new InMemorySheetAdapter();
  const runner = new MigrationRunner(migrations.slice(0, 3), adapter);
  runner.migrate();
  adapter.appendRow('users', { id: 1, email: 'a@a.com', password: 'x' });

  assert.deepEqual(runner.rollback(), ['003_add_role_and_disabled_to_users']);
  assert.equal(adapter.getHeaders('users').includes('role'), false);
  assert.equal(adapter.getHeaders('users').includes('disabled'), false);
  assert.equal(adapter.getRows('users')[0].email, 'a@a.com');
});

test('app migrations create a tags sheet', () => {
  const adapter = new InMemorySheetAdapter();
  new MigrationRunner(migrations, adapter).migrate();

  const headers = adapter.getHeaders('tags');
  assert.ok(headers.includes('name'));
  assert.ok(headers.includes('slug'));
  assert.ok(headers.includes('created_at'));
  assert.ok(headers.includes('updated_at'));
  assert.ok(headers.includes('deleted_at'));
});

test('rolling back the tags migration drops the tags sheet', () => {
  const adapter = new InMemorySheetAdapter();
  const runner = new MigrationRunner(migrations.slice(0, 4), adapter);
  runner.migrate();

  assert.deepEqual(runner.rollback(), ['004_create_tags']);
  assert.equal(adapter.sheetExists('tags'), false);
});

test('app migrations create a posts sheet with status, visibility and soft delete', () => {
  const adapter = new InMemorySheetAdapter();
  new MigrationRunner(migrations, adapter).migrate();

  const headers = adapter.getHeaders('posts');
  assert.ok(headers.includes('author_id'));
  assert.ok(headers.includes('title'));
  assert.ok(headers.includes('slug'));
  assert.ok(headers.includes('excerpt'));
  assert.ok(headers.includes('body'));
  assert.ok(headers.includes('status'));
  assert.ok(headers.includes('visibility'));
  assert.ok(headers.includes('published_at'));
  assert.ok(headers.includes('deleted_at'));
});

test('rolling back the posts migration drops the posts sheet', () => {
  const adapter = new InMemorySheetAdapter();
  const runner = new MigrationRunner(migrations.slice(0, 6), adapter);
  runner.migrate();

  assert.deepEqual(runner.rollback(), ['006_create_post_tags']);
  assert.deepEqual(runner.rollback(), ['005_create_posts']);
  assert.equal(adapter.sheetExists('posts'), false);
});

test('app migrations create a post_tags pivot sheet without soft delete (detach is a hard delete)', () => {
  const adapter = new InMemorySheetAdapter();
  new MigrationRunner(migrations, adapter).migrate();

  const headers = adapter.getHeaders('post_tags');
  assert.ok(headers.includes('post_id'));
  assert.ok(headers.includes('tag_id'));
  assert.equal(headers.includes('deleted_at'), false);
});

test('rolling back the post_tags migration drops the pivot sheet', () => {
  const adapter = new InMemorySheetAdapter();
  const runner = new MigrationRunner(migrations.slice(0, 6), adapter);
  runner.migrate();

  assert.deepEqual(runner.rollback(), ['006_create_post_tags']);
  assert.equal(adapter.sheetExists('post_tags'), false);
});

test('app migrations create a comments sheet with soft delete', () => {
  const adapter = new InMemorySheetAdapter();
  new MigrationRunner(migrations, adapter).migrate();

  const headers = adapter.getHeaders('comments');
  assert.ok(headers.includes('post_id'));
  assert.ok(headers.includes('author_id'));
  assert.ok(headers.includes('body'));
  assert.ok(headers.includes('deleted_at'));
});

test('rolling back the comments migration drops the sheet', () => {
  const adapter = new InMemorySheetAdapter();
  const runner = new MigrationRunner(migrations.slice(0, 7), adapter);
  runner.migrate();

  assert.deepEqual(runner.rollback(), ['007_create_comments']);
  assert.equal(adapter.sheetExists('comments'), false);
});

test('app migrations create a media sheet with soft delete', () => {
  const adapter = new InMemorySheetAdapter();
  new MigrationRunner(migrations, adapter).migrate();

  const headers = adapter.getHeaders('media');
  assert.ok(headers.includes('post_id'));
  assert.ok(headers.includes('owner_id'));
  assert.ok(headers.includes('drive_file_id'));
  assert.ok(headers.includes('name'));
  assert.ok(headers.includes('mime_type'));
  assert.ok(headers.includes('size'));
  assert.ok(headers.includes('kind'));
  assert.ok(headers.includes('is_public'));
  assert.ok(headers.includes('deleted_at'));
});

test('rolling back the media migration drops the sheet', () => {
  const adapter = new InMemorySheetAdapter();
  const runner = new MigrationRunner(migrations, adapter);
  runner.migrate();

  assert.deepEqual(runner.rollback(), ['008_create_media']);
  assert.equal(adapter.sheetExists('media'), false);
});
