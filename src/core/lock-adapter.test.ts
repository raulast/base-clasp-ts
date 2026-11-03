import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noopLock } from './lock-adapter.ts';
import { InMemoryLockAdapter } from './testing/in-memory-lock-adapter.ts';

test('noopLock runs fn directly and returns its result', () => {
  const result = noopLock.withLock(() => 42);
  assert.equal(result, 42);
});

test('InMemoryLockAdapter runs a nested withLock inside an outer one directly, without a second acquisition', () => {
  const lock = new InMemoryLockAdapter();
  const order: string[] = [];

  const result = lock.withLock(() => {
    order.push('outer-start');
    const inner = lock.withLock(() => {
      order.push('inner');
      return 'inner-value';
    });
    order.push('outer-end');
    return inner;
  });

  assert.equal(result, 'inner-value');
  assert.deepEqual(order, ['outer-start', 'inner', 'outer-end']);
  assert.equal(lock.acquisitions, 1);
  assert.equal(lock.releases, 1);
});

test('InMemoryLockAdapter releases the lock even when fn throws', () => {
  const lock = new InMemoryLockAdapter();

  assert.throws(() => {
    lock.withLock(() => {
      throw new Error('boom');
    });
  }, /boom/);

  assert.equal(lock.acquisitions, 1);
  assert.equal(lock.releases, 1);

  const result = lock.withLock(() => 'after-throw');
  assert.equal(result, 'after-throw');
  assert.equal(lock.acquisitions, 2);
  assert.equal(lock.releases, 2);
});

test('InMemoryLockAdapter releases a nested lock only once, even when the inner call throws', () => {
  const lock = new InMemoryLockAdapter();

  assert.throws(() => {
    lock.withLock(() => {
      lock.withLock(() => {
        throw new Error('nested boom');
      });
    });
  }, /nested boom/);

  assert.equal(lock.acquisitions, 1);
  assert.equal(lock.releases, 1);
});
