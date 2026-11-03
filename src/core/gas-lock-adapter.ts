import type { LockAdapter } from './lock-adapter.ts';
import { HttpError } from './api.ts';

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * GAS LockService.getScriptLock(), made reentrant like the in-memory
 * adapter so a nested withLock never tries to acquire a second time.
 */
export class GasLockAdapter implements LockAdapter {
  private readonly timeoutMs: number;
  private depth = 0;

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  withLock<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
      }
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(this.timeoutMs)) {
      throw new HttpError(503, 'BUSY', 'Server is busy, try again');
    }
    this.depth = 1;
    try {
      return fn();
    } finally {
      this.depth = 0;
      lock.releaseLock();
    }
  }
}
