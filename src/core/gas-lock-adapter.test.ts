import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GasLockAdapter } from './gas-lock-adapter.ts';

const globals = globalThis as Record<string, unknown>;
let tryLockCalls: number[] = [];
let tryLockResult = true;
let releaseCalls = 0;

beforeEach(() => {
  tryLockCalls = [];
  tryLockResult = true;
  releaseCalls = 0;
  globals.LockService = {
    getScriptLock: () => ({
      tryLock: (timeoutMs: number) => {
        tryLockCalls.push(timeoutMs);
        return tryLockResult;
      },
      releaseLock: () => {
        releaseCalls++;
      },
      hasLock: () => true,
      waitLock: () => {},
    }),
  };
});

test('withLock calls tryLock with the default timeout and releases in finally', () => {
  const lock = new GasLockAdapter();

  const result = lock.withLock(() => 'value');

  assert.equal(result, 'value');
  assert.deepEqual(tryLockCalls, [10000]);
  assert.equal(releaseCalls, 1);
});

test('withLock accepts a custom timeout', () => {
  const lock = new GasLockAdapter(5000);

  lock.withLock(() => undefined);

  assert.deepEqual(tryLockCalls, [5000]);
});

test('withLock releases the lock even when fn throws', () => {
  const lock = new GasLockAdapter();

  assert.throws(() => {
    lock.withLock(() => {
      throw new Error('boom');
    });
  }, /boom/);

  assert.equal(releaseCalls, 1);
});

test('withLock throws an HttpError 503 BUSY when the lock is not acquired, without releasing', () => {
  tryLockResult = false;
  const lock = new GasLockAdapter();

  assert.throws(
    () => lock.withLock(() => 'unreachable'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { status?: number }).status, 503);
      assert.equal((error as { code?: string }).code, 'BUSY');
      return true;
    },
  );
  assert.equal(releaseCalls, 0);
});

test('a nested withLock inside withLock acquires the underlying lock only once', () => {
  const lock = new GasLockAdapter();

  lock.withLock(() => {
    lock.withLock(() => 'nested');
  });

  assert.equal(tryLockCalls.length, 1);
  assert.equal(releaseCalls, 1);
});
