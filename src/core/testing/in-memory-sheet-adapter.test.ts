import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from './in-memory-sheet-adapter.ts';

test('seed + getHeaders + getRows', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email'], [{ id: 1, email: 'a@a.com' }]);
  assert.deepEqual(adapter.getHeaders('users'), ['id', 'email']);
  assert.deepEqual(adapter.getRows('users'), [{ id: 1, email: 'a@a.com' }]);
});

test('getRows returns a copy, not a live reference', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id'], [{ id: 1 }]);
  const rows = adapter.getRows('users');
  rows[0].id = 999;
  assert.equal(adapter.getRows('users')[0].id, 1);
});

test('appendRow adds a row', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id'], []);
  adapter.appendRow('users', { id: 1 });
  assert.deepEqual(adapter.getRows('users'), [{ id: 1 }]);
});

test('findRowIndex finds a matching row, -1 when none matches', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id'], [{ id: 1 }, { id: 2 }]);
  assert.equal(adapter.findRowIndex('users', (row) => row.id === 2), 1);
  assert.equal(adapter.findRowIndex('users', (row) => row.id === 999), -1);
});

test('updateRow replaces the row at an index', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email'], [{ id: 1, email: 'a@a.com' }]);
  adapter.updateRow('users', 0, { id: 1, email: 'b@b.com' });
  assert.deepEqual(adapter.getRows('users'), [{ id: 1, email: 'b@b.com' }]);
});

test('updateRow throws for an out-of-range index', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id'], [{ id: 1 }]);
  assert.throws(() => adapter.updateRow('users', 5, { id: 1 }), RangeError);
});

test('deleteRow removes the row at an index', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id'], [{ id: 1 }, { id: 2 }]);
  adapter.deleteRow('users', 0);
  assert.deepEqual(adapter.getRows('users'), [{ id: 2 }]);
});

test('deleteRow throws for an out-of-range index', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id'], [{ id: 1 }]);
  assert.throws(() => adapter.deleteRow('users', 5), RangeError);
});

test('getRows throws for an unknown sheet', () => {
  const adapter = new InMemorySheetAdapter();
  assert.throws(() => adapter.getRows('ghost'), Error);
});
