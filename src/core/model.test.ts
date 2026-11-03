import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from './testing/in-memory-sheet-adapter.ts';
import { InMemoryLockAdapter } from './testing/in-memory-lock-adapter.ts';
import { Model } from './model.ts';

const FIXED_NOW = () => new Date(1700000000000);

test('create assigns an incrementing id and sets timestamps when the headers support them', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'created_at', 'updated_at'], [{ id: 1, email: 'a@a.com' }]);
  const users = new Model('users', adapter, FIXED_NOW);

  const created = users.create({ email: 'b@b.com' });

  assert.equal(created.id, 2);
  assert.equal(created.created_at, 1700000000000);
  assert.equal(created.updated_at, 1700000000000);
});

test('create does not add timestamp fields the sheet headers do not have', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email'], []);
  const users = new Model('users', adapter, FIXED_NOW);

  const created = users.create({ email: 'a@a.com' });

  assert.equal('created_at' in created, false);
  assert.equal('updated_at' in created, false);
});

test('all hides soft-deleted rows by default when the sheet has a deleted_at column', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'deleted_at'], [
    { id: 1, email: 'a@a.com', deleted_at: null },
    { id: 2, email: 'b@b.com', deleted_at: 1700000000000 },
  ]);
  const users = new Model('users', adapter, FIXED_NOW);

  assert.deepEqual(users.all().map((row) => row.id), [1]);
  assert.deepEqual(users.all({ includeDeleted: true }).map((row) => row.id), [1, 2]);
});

test('all returns every row when the sheet has no deleted_at column', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email'], [{ id: 1, email: 'a@a.com' }, { id: 2, email: 'b@b.com' }]);
  const users = new Model('users', adapter, FIXED_NOW);

  assert.equal(users.all().length, 2);
});

test('find returns the matching row, or null when missing', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email'], [{ id: 1, email: 'a@a.com' }]);
  const users = new Model('users', adapter, FIXED_NOW);

  assert.deepEqual(users.find(1), { id: 1, email: 'a@a.com' });
  assert.equal(users.find(999), null);
});

test('find hides a soft-deleted row unless includeDeleted is set', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'deleted_at'], [{ id: 1, email: 'a@a.com', deleted_at: 1700000000000 }]);
  const users = new Model('users', adapter, FIXED_NOW);

  assert.equal(users.find(1), null);
  assert.equal(users.find(1, { includeDeleted: true })?.id, 1);
});

test('update merges fields, bumps updated_at, and ignores an id in the payload', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'updated_at'], [{ id: 1, email: 'a@a.com', updated_at: 0 }]);
  const users = new Model('users', adapter, FIXED_NOW);

  const updated = users.update(1, { email: 'new@a.com', id: 999 });

  assert.deepEqual(updated, { id: 1, email: 'new@a.com', updated_at: 1700000000000 });
});

test('update returns null for a missing id', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email'], [{ id: 1, email: 'a@a.com' }]);
  const users = new Model('users', adapter, FIXED_NOW);

  assert.equal(users.update(999, { email: 'x' }), null);
});

test('delete soft-deletes when deleted_at exists, hiding the row from all() but keeping it in the sheet', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'deleted_at'], [{ id: 1, email: 'a@a.com', deleted_at: null }]);
  const users = new Model('users', adapter, FIXED_NOW);

  assert.equal(users.delete(1), true);
  assert.equal(users.all().length, 0);
  assert.equal(adapter.getRows('users').length, 1);
  assert.equal(adapter.getRows('users')[0].deleted_at, 1700000000000);
});

test('delete hard-deletes when the sheet has no deleted_at column', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email'], [{ id: 1, email: 'a@a.com' }]);
  const users = new Model('users', adapter, FIXED_NOW);

  assert.equal(users.delete(1), true);
  assert.equal(adapter.getRows('users').length, 0);
});

test('delete returns false for a missing id', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email'], [{ id: 1, email: 'a@a.com' }]);
  const users = new Model('users', adapter, FIXED_NOW);

  assert.equal(users.delete(999), false);
});

test('paginate slices rows and reports page metadata', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed(
    'users',
    ['id'],
    Array.from({ length: 5 }, (_, index) => ({ id: index + 1 })),
  );
  const users = new Model('users', adapter, FIXED_NOW);

  const page = users.paginate(2, 2);

  assert.deepEqual(page, { page: 2, perPage: 2, total: 5, pages: 3, data: [{ id: 3 }, { id: 4 }] });
});

test('create acquires the lock exactly once', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email'], []);
  const lock = new InMemoryLockAdapter();
  const users = new Model('users', adapter, FIXED_NOW, lock);

  users.create({ email: 'a@a.com' });

  assert.equal(lock.acquisitions, 1);
  assert.equal(lock.releases, 1);
});

test('update acquires the lock exactly once', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email'], [{ id: 1, email: 'a@a.com' }]);
  const lock = new InMemoryLockAdapter();
  const users = new Model('users', adapter, FIXED_NOW, lock);

  users.update(1, { email: 'b@b.com' });

  assert.equal(lock.acquisitions, 1);
  assert.equal(lock.releases, 1);
});

test('delete acquires the lock exactly once', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email'], [{ id: 1, email: 'a@a.com' }]);
  const lock = new InMemoryLockAdapter();
  const users = new Model('users', adapter, FIXED_NOW, lock);

  users.delete(1);

  assert.equal(lock.acquisitions, 1);
  assert.equal(lock.releases, 1);
});

test('create computes the next id inside the lock, after a competing writer appends a row on acquire', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email'], [{ id: 1, email: 'a@a.com' }]);
  const lock = new InMemoryLockAdapter({
    onAcquire: () => {
      adapter.appendRow('users', { id: 2, email: 'competitor@a.com' });
    },
  });
  const users = new Model('users', adapter, FIXED_NOW, lock);

  const created = users.create({ email: 'b@b.com' });

  assert.equal(created.id, 3);
});

test('withLock exposes the underlying lock for callers that need to wrap several operations', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email'], []);
  const lock = new InMemoryLockAdapter();
  const users = new Model('users', adapter, FIXED_NOW, lock);

  const result = users.withLock(() => 'value');

  assert.equal(result, 'value');
  assert.equal(lock.acquisitions, 1);
});

test('firstOrCreate returns an existing non-deleted matching row with created: false', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'role'], [{ id: 1, email: 'a@a.com', role: 'admin' }]);
  const users = new Model('users', adapter, FIXED_NOW);

  const result = users.firstOrCreate({ email: 'a@a.com' }, { role: 'reader' });

  assert.equal(result.created, false);
  assert.deepEqual(result.row, { id: 1, email: 'a@a.com', role: 'admin' });
});

test('firstOrCreate creates a new row merging defaults with match when nothing matches', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'role'], []);
  const users = new Model('users', adapter, FIXED_NOW);

  const result = users.firstOrCreate({ email: 'b@b.com' }, { role: 'reader' });

  assert.equal(result.created, true);
  assert.equal(result.row.email, 'b@b.com');
  assert.equal(result.row.role, 'reader');
});

test('firstOrCreate match wins over defaults when both specify the same key', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'role'], []);
  const users = new Model('users', adapter, FIXED_NOW);

  const result = users.firstOrCreate({ role: 'admin' }, { role: 'reader' });

  assert.equal(result.row.role, 'admin');
});

test('firstOrCreate ignores soft-deleted rows when matching', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'deleted_at'], [{ id: 1, email: 'a@a.com', deleted_at: 1700000000000 }]);
  const users = new Model('users', adapter, FIXED_NOW);

  const result = users.firstOrCreate({ email: 'a@a.com' });

  assert.equal(result.created, true);
  assert.equal(adapter.getRows('users').length, 2);
});

test('firstOrCreate matches values across string and number representations', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('tags', ['id', 'name'], [{ id: 5, name: 'ts' }]);
  const tags = new Model('tags', adapter, FIXED_NOW);

  const result = tags.firstOrCreate({ id: '5' });

  assert.equal(result.created, false);
  assert.equal(result.row.id, 5);
});

test('firstOrCreate runs under a single lock acquisition', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('tags', ['id', 'name'], []);
  const lock = new InMemoryLockAdapter();
  const tags = new Model('tags', adapter, FIXED_NOW, lock);

  tags.firstOrCreate({ name: 'ts' });

  assert.equal(lock.acquisitions, 1);
  assert.equal(lock.releases, 1);
});
