import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from './testing/in-memory-sheet-adapter.ts';
import { InMemoryLockAdapter } from './testing/in-memory-lock-adapter.ts';
import { Model } from './model.ts';
import { sameId, hasMany, belongsTo, belongsToMany } from './relations.ts';

const FIXED_NOW = () => new Date(1700000000000);

test('sameId compares values as strings, so numeric and string ids match', () => {
  assert.equal(sameId(1, '1'), true);
  assert.equal(sameId('1', 1), true);
  assert.equal(sameId(1, 2), false);
  assert.equal(sameId(null, 'null'), false);
  assert.equal(sameId(null, null), false);
  assert.equal(sameId('', ''), false);
});

test('hasMany returns non-deleted related rows matching the foreign key, numeric or string', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('comments', ['id', 'post_id', 'body', 'deleted_at'], [
    { id: 1, post_id: 1, body: 'a', deleted_at: null },
    { id: 2, post_id: '1', body: 'b', deleted_at: null },
    { id: 3, post_id: 1, body: 'c', deleted_at: 1700000000000 },
    { id: 4, post_id: 2, body: 'd', deleted_at: null },
  ]);
  const comments = new Model('comments', adapter, FIXED_NOW);

  const result = hasMany(comments, 'post_id', 1);

  assert.deepEqual(result.map((row) => row.id), [1, 2]);
});

test('hasMany accepts an extra query filter', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('comments', ['id', 'post_id', 'body'], [
    { id: 1, post_id: 1, body: 'keep' },
    { id: 2, post_id: 1, body: 'skip' },
  ]);
  const comments = new Model('comments', adapter, FIXED_NOW);

  const result = hasMany(comments, 'post_id', 1, { where: (row) => row.body === 'keep' });

  assert.deepEqual(result.map((row) => row.id), [1]);
});

test('belongsTo returns the related row, matching numeric and string ids, null when missing or deleted', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'deleted_at'], [
    { id: 1, email: 'a@a.com', deleted_at: null },
    { id: 2, email: 'b@b.com', deleted_at: 1700000000000 },
  ]);
  const users = new Model('users', adapter, FIXED_NOW);

  assert.equal(belongsTo(users, '1')?.email, 'a@a.com');
  assert.equal(belongsTo(users, 2), null);
  assert.equal(belongsTo(users, 999), null);
});

test('belongsToMany get returns related rows in pivot order and ignores pivot rows pointing to missing or deleted rows', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('post_tags', ['id', 'post_id', 'tag_id'], [
    { id: 1, post_id: 1, tag_id: 3 },
    { id: 2, post_id: 1, tag_id: 1 },
    { id: 3, post_id: 1, tag_id: 999 },
  ]);
  adapter.seed('tags', ['id', 'name', 'deleted_at'], [
    { id: 1, name: 'ts', deleted_at: null },
    { id: 2, name: 'gone', deleted_at: 1700000000000 },
    { id: 3, name: 'js', deleted_at: null },
  ]);
  const pivot = new Model('post_tags', adapter, FIXED_NOW);
  const tags = new Model('tags', adapter, FIXED_NOW);
  const postTags = belongsToMany(pivot, tags, 'post_id', 'tag_id');

  const result = postTags.get(1);

  assert.deepEqual(result.map((row) => row.name), ['js', 'ts']);
});

test('belongsToMany attach is idempotent, creating no duplicate pivot rows', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('post_tags', ['id', 'post_id', 'tag_id'], [{ id: 1, post_id: 1, tag_id: 1 }]);
  adapter.seed('tags', ['id', 'name'], [{ id: 1, name: 'ts' }, { id: 2, name: 'js' }]);
  const pivot = new Model('post_tags', adapter, FIXED_NOW);
  const tags = new Model('tags', adapter, FIXED_NOW);
  const postTags = belongsToMany(pivot, tags, 'post_id', 'tag_id');

  postTags.attach(1, [1, 2]);
  postTags.attach(1, [2]);

  assert.equal(adapter.getRows('post_tags').length, 2);
});

test('belongsToMany detach without ids removes all of the owner pivot rows', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('post_tags', ['id', 'post_id', 'tag_id'], [
    { id: 1, post_id: 1, tag_id: 1 },
    { id: 2, post_id: 1, tag_id: 2 },
    { id: 3, post_id: 2, tag_id: 1 },
  ]);
  adapter.seed('tags', ['id', 'name'], [{ id: 1, name: 'ts' }, { id: 2, name: 'js' }]);
  const pivot = new Model('post_tags', adapter, FIXED_NOW);
  const tags = new Model('tags', adapter, FIXED_NOW);
  const postTags = belongsToMany(pivot, tags, 'post_id', 'tag_id');

  postTags.detach(1);

  assert.deepEqual(
    adapter.getRows('post_tags').map((row) => row.post_id),
    [2],
  );
});

test('belongsToMany detach with ids removes only those pivot rows', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('post_tags', ['id', 'post_id', 'tag_id'], [
    { id: 1, post_id: 1, tag_id: 1 },
    { id: 2, post_id: 1, tag_id: 2 },
  ]);
  adapter.seed('tags', ['id', 'name'], [{ id: 1, name: 'ts' }, { id: 2, name: 'js' }]);
  const pivot = new Model('post_tags', adapter, FIXED_NOW);
  const tags = new Model('tags', adapter, FIXED_NOW);
  const postTags = belongsToMany(pivot, tags, 'post_id', 'tag_id');

  postTags.detach(1, [1]);

  assert.deepEqual(adapter.getRows('post_tags').map((row) => row.tag_id), [2]);
});

test('belongsToMany sync makes the pivot exactly equal to the given ids, attaching missing and detaching extra', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('post_tags', ['id', 'post_id', 'tag_id'], [
    { id: 1, post_id: 1, tag_id: 1 },
    { id: 2, post_id: 1, tag_id: 2 },
  ]);
  adapter.seed('tags', ['id', 'name'], [{ id: 1, name: 'ts' }, { id: 2, name: 'js' }, { id: 3, name: 'go' }]);
  const pivot = new Model('post_tags', adapter, FIXED_NOW);
  const tags = new Model('tags', adapter, FIXED_NOW);
  const postTags = belongsToMany(pivot, tags, 'post_id', 'tag_id');

  postTags.sync(1, [2, 3]);

  const rows = adapter.getRows('post_tags').filter((row) => sameId(row.post_id, 1));
  assert.deepEqual(rows.map((row) => row.tag_id).sort(), [2, 3]);
});

test('belongsToMany sync accepts numeric and string ids mixed with the stored pivot values', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('post_tags', ['id', 'post_id', 'tag_id'], [{ id: 1, post_id: '1', tag_id: 1 }]);
  adapter.seed('tags', ['id', 'name'], [{ id: 1, name: 'ts' }, { id: 2, name: 'js' }]);
  const pivot = new Model('post_tags', adapter, FIXED_NOW);
  const tags = new Model('tags', adapter, FIXED_NOW);
  const postTags = belongsToMany(pivot, tags, 'post_id', 'tag_id');

  postTags.sync('1', ['1', 2]);

  const rows = adapter.getRows('post_tags').filter((row) => sameId(row.post_id, 1));
  assert.equal(rows.length, 2);
});

test('belongsToMany sync runs under a single lock acquisition', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('post_tags', ['id', 'post_id', 'tag_id'], [{ id: 1, post_id: 1, tag_id: 1 }]);
  adapter.seed('tags', ['id', 'name'], [{ id: 1, name: 'ts' }, { id: 2, name: 'js' }]);
  const lock = new InMemoryLockAdapter();
  const pivot = new Model('post_tags', adapter, FIXED_NOW, lock);
  const tags = new Model('tags', adapter, FIXED_NOW);
  const postTags = belongsToMany(pivot, tags, 'post_id', 'tag_id');

  postTags.sync(1, [2]);

  assert.equal(lock.acquisitions, 1);
  assert.equal(lock.releases, 1);
});

class CountingSheetAdapter extends InMemorySheetAdapter {
  reads: Record<string, number> = {};

  getRows(sheetName: string) {
    this.reads[sheetName] = (this.reads[sheetName] ?? 0) + 1;
    return super.getRows(sheetName);
  }
}

test('belongsToMany.get reads the related sheet once, whatever the number of pivot rows', () => {
  const adapter = new CountingSheetAdapter();
  adapter.seed('tags', ['id', 'name'], [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }]);
  adapter.seed('post_tags', ['id', 'post_id', 'tag_id'], [
    { id: 1, post_id: 1, tag_id: 1 },
    { id: 2, post_id: 1, tag_id: 2 },
    { id: 3, post_id: 1, tag_id: 3 },
  ]);
  const tags = belongsToMany(new Model('post_tags', adapter, FIXED_NOW), new Model('tags', adapter, FIXED_NOW), 'post_id', 'tag_id');
  adapter.reads = {};

  assert.deepEqual(tags.get(1).map((row) => row.id), [1, 2, 3]);
  assert.equal(adapter.reads.tags, 1);
});

test('belongsToMany.sync and attach ignore duplicate ids in the input', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('tags', ['id', 'name'], [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
  adapter.seed('post_tags', ['id', 'post_id', 'tag_id']);
  const tags = belongsToMany(new Model('post_tags', adapter, FIXED_NOW), new Model('tags', adapter, FIXED_NOW), 'post_id', 'tag_id');

  tags.sync(1, [1, '1', 2, 2]);
  tags.attach(1, [2, 2]);

  assert.equal(adapter.getRows('post_tags').length, 2);
});

test('hasMany with a missing owner id matches nothing', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('comments', ['id', 'post_id'], [{ id: 1, post_id: '' }, { id: 2, post_id: null }]);

  assert.deepEqual(hasMany(new Model('comments', adapter, FIXED_NOW), 'post_id', null), []);
});
