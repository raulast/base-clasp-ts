import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../../core/testing/in-memory-sheet-adapter.ts';
import { NodeCryptoAdapter } from '../../core/testing/node-crypto-adapter.ts';
import { HttpError } from '../../core/api.ts';
import { signJwt } from '../../core/auth.ts';
import { createUser } from '../models/user.model.ts';
import { optionalAuth, requireAuth } from './auth.middleware.ts';
import type { Request } from '../../core/router.ts';

const SECRET = 'test-secret';
const NOW = () => new Date(1700000000000);

function setup() {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'username', 'password', 'role', 'disabled', 'created_at', 'updated_at', 'deleted_at']);
  const crypto = new NodeCryptoAdapter();
  const deps = { adapter, crypto, getSecret: () => SECRET, now: NOW };
  return { adapter, crypto, deps };
}

function request(overrides: Partial<Request> = {}): Request {
  return { path: '/x', method: 'GET', params: {}, body: {}, ...overrides };
}

function tokenFor(userId: unknown, deps: { crypto: NodeCryptoAdapter }) {
  return signJwt({ sub: userId }, SECRET, 3600, deps.crypto, NOW);
}

test('optionalAuth sets user to null when there is no token', () => {
  const { deps } = setup();
  let seen: unknown = 'unset';
  const middleware = optionalAuth(deps);

  middleware(request(), () => {
    seen = undefined;
    return { status: 200, body: {} };
  });

  const req = request();
  middleware(req, () => ({ status: 200, body: {} }));
  assert.equal(req.user, null);
});

test('requireAuth throws 401 when there is no token', () => {
  const { deps } = setup();
  const middleware = requireAuth(deps);

  assert.throws(() => middleware(request(), () => ({ status: 200, body: {} })), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 401);
    assert.equal(error.code, 'UNAUTHENTICATED');
    return true;
  });
});

test('optionalAuth and requireAuth both reject an invalid token', () => {
  const { deps } = setup();
  const optional = optionalAuth(deps);
  const required = requireAuth(deps);

  assert.throws(() => optional(request({ body: { token: 'garbage' } }), () => ({ status: 200, body: {} })));
  assert.throws(() => required(request({ body: { token: 'garbage' } }), () => ({ status: 200, body: {} })));
});

test('both reject an expired token', () => {
  const { deps, crypto } = setup();
  const expired = signJwt({ sub: 1 }, SECRET, -10, crypto, NOW);
  const optional = optionalAuth(deps);
  const required = requireAuth(deps);

  assert.throws(() => optional(request({ body: { token: expired } }), () => ({ status: 200, body: {} })));
  assert.throws(() => required(request({ body: { token: expired } }), () => ({ status: 200, body: {} })));
});

test('both reject a token for a disabled user', () => {
  const { adapter, crypto, deps } = setup();
  const user = createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);
  adapter.updateRow('users', adapter.findRowIndex('users', (row) => row.id === user.id), {
    ...adapter.getRows('users')[0],
    disabled: true,
  });
  const token = tokenFor(user.id, deps);
  const optional = optionalAuth(deps);
  const required = requireAuth(deps);

  assert.throws(() => optional(request({ body: { token } }), () => ({ status: 200, body: {} })));
  assert.throws(() => required(request({ body: { token } }), () => ({ status: 200, body: {} })));
});

test('both reject a token for a missing user', () => {
  const { deps, crypto } = setup();
  const token = signJwt({ sub: 999 }, SECRET, 3600, crypto, NOW);
  const optional = optionalAuth(deps);
  const required = requireAuth(deps);

  assert.throws(() => optional(request({ body: { token } }), () => ({ status: 200, body: {} })));
  assert.throws(() => required(request({ body: { token } }), () => ({ status: 200, body: {} })));
});

test('a valid token sets request.user to a sanitized user with normalized role and disabled', () => {
  const { adapter, crypto, deps } = setup();
  const user = createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);
  const token = tokenFor(user.id, deps);
  const required = requireAuth(deps);
  const req = request({ body: { token } });

  required(req, () => ({ status: 200, body: {} }));

  assert.ok(req.user);
  assert.equal((req.user as { role?: string }).role, 'reader');
  assert.equal((req.user as { disabled?: boolean }).disabled, false);
  assert.ok(!('password' in (req.user as object)));
});

for (const [label, token] of [
  ['a number', 12345],
  ['an empty array', []],
  ['an array', ['a.b.c']],
  ['an object', { value: 'a.b.c' }],
  ['an empty string', ''],
] as const) {
  test(`optionalAuth and requireAuth reject a token that is ${label} with 401, not a crash`, () => {
    const { deps } = setup();
    for (const middleware of [optionalAuth(deps), requireAuth(deps)]) {
      assert.throws(
        () => middleware(request({ body: { token } }), () => ({ status: 200, body: {} })),
        (error: unknown) => error instanceof HttpError && error.status === 401,
      );
    }
  });
}

test('optionalAuth treats a null token as no token', () => {
  const { deps } = setup();
  const req = request({ body: { token: null } });

  optionalAuth(deps)(req, () => ({ status: 200, body: {} }));

  assert.equal(req.user, null);
});
