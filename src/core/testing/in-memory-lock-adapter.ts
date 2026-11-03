import type { LockAdapter } from '../lock-adapter.ts';

export interface InMemoryLockAdapterOptions {
  onAcquire?: () => void;
}

/**
 * Reentrant in-memory LockAdapter for tests: only the outermost withLock
 * acquires/releases, matching the GAS adapter's single-lock semantics.
 */
export class InMemoryLockAdapter implements LockAdapter {
  acquisitions = 0;
  releases = 0;
  private depth = 0;
  private readonly onAcquire?: () => void;

  constructor(options: InMemoryLockAdapterOptions = {}) {
    this.onAcquire = options.onAcquire;
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
    this.depth = 1;
    this.acquisitions++;
    this.onAcquire?.();
    try {
      return fn();
    } finally {
      this.depth = 0;
      this.releases++;
    }
  }
}
