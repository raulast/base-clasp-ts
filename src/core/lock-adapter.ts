export interface LockAdapter {
  withLock<T>(fn: () => T): T;
}

export const noopLock: LockAdapter = {
  withLock<T>(fn: () => T): T {
    return fn();
  },
};
