import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../core/testing/in-memory-sheet-adapter.ts';
import { NodeCryptoAdapter } from '../core/testing/node-crypto-adapter.ts';
import { hashPassword } from '../core/auth.ts';
import { createRouter } from './routes.ts';
import { createUser, LOGIN_ERROR_MESSAGE } from './controllers/auth.controller.ts';
import type { Request } from '../core/router.ts';

const SECRET = 'test-secret';
const NOW = () => new Date(1700000000000);

function setup() {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'username', 'password', 'created_at', 'updated_at', 'deleted_at']);
  const crypto = new NodeCryptoAdapter();
  const router = createRouter({ adapter, crypto, getSecret: () => SECRET, now: NOW });
  return { adapter, crypto, router };
}

function request(overrides: Partial<Request> = {}): Request {
  return { path: '/', method: 'GET', params: {}, body: {}, ...overrides };
}

test('createUser hashes the password and strips it from the returned row', () => {
  const { adapter, crypto } = setup();

  const user = createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);

  assert.equal(user.email, 'ana@example.com');
  assert.ok(!('password' in user));
  const stored = adapter.getRows('users')[0];
  assert.notEqual(stored.password, 'secret');
});

test('createUser rejects a duplicate email', () => {
  const { adapter, crypto } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);

  assert.throws(() => createUser(adapter, crypto, 'ana@example.com', 'other', 'ana2', NOW));
});

test('POST /login returns a token for the right credentials', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);

  const response = router.dispatch(
    request({ path: '/login', method: 'POST', body: { email: 'ana@example.com', password: 'secret' } }),
  );

  assert.equal(response.status, 200);
  assert.ok(typeof (response.body as { token?: string }).token === 'string');
});

test('POST /login returns the same error for an unknown email and a wrong password', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);

  const unknownEmail = router.dispatch(
    request({ path: '/login', method: 'POST', body: { email: 'nobody@example.com', password: 'secret' } }),
  );
  const wrongPassword = router.dispatch(
    request({ path: '/login', method: 'POST', body: { email: 'ana@example.com', password: 'wrong' } }),
  );

  assert.equal(unknownEmail.status, 401);
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(unknownEmail.body, { error: LOGIN_ERROR_MESSAGE });
  assert.deepEqual(wrongPassword.body, { error: LOGIN_ERROR_MESSAGE });
});

test('POST /me returns the current user for a valid token, without password', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);
  const loginResponse = router.dispatch(
    request({ path: '/login', method: 'POST', body: { email: 'ana@example.com', password: 'secret' } }),
  );
  const token = (loginResponse.body as { token: string }).token;

  const meResponse = router.dispatch(request({ path: '/me', method: 'POST', body: { token } }));

  assert.equal(meResponse.status, 200);
  const body = meResponse.body as { email: string };
  assert.equal(body.email, 'ana@example.com');
  assert.ok(!('password' in body));
});

test('POST /me without a token is 401', () => {
  const { router } = setup();

  const response = router.dispatch(request({ path: '/me', method: 'POST' }));

  assert.equal(response.status, 401);
});

test('POST /me with a tampered token is 401', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);
  const loginResponse = router.dispatch(
    request({ path: '/login', method: 'POST', body: { email: 'ana@example.com', password: 'secret' } }),
  );
  const token = (loginResponse.body as { token: string }).token;
  const tampered = token.slice(0, -2) + 'xx';

  const response = router.dispatch(request({ path: '/me', method: 'POST', body: { token: tampered } }));

  assert.equal(response.status, 401);
});

test('there is no GET /me route', () => {
  const { router } = setup();

  const response = router.dispatch(request({ path: '/me', method: 'GET' }));

  assert.equal(response.status, 404);
});

test('/me with the token only in params (not body) is 401', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);
  const loginResponse = router.dispatch(
    request({ path: '/login', method: 'POST', body: { email: 'ana@example.com', password: 'secret' } }),
  );
  const token = (loginResponse.body as { token: string }).token;

  const response = router.dispatch(request({ path: '/me', method: 'POST', params: { token } }));

  assert.equal(response.status, 401);
});

test('/me with the token in the body via POST is OK', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);
  const loginResponse = router.dispatch(
    request({ path: '/login', method: 'POST', body: { email: 'ana@example.com', password: 'secret' } }),
  );
  const token = (loginResponse.body as { token: string }).token;

  const response = router.dispatch(request({ path: '/me', method: 'POST', body: { token } }));

  assert.equal(response.status, 200);
});

test('no response from login or me ever contains a password field', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);
  const loginResponse = router.dispatch(
    request({ path: '/login', method: 'POST', body: { email: 'ana@example.com', password: 'secret' } }),
  );
  const token = (loginResponse.body as { token: string }).token;
  const meResponse = router.dispatch(request({ path: '/me', method: 'POST', body: { token } }));

  assert.ok(!JSON.stringify(loginResponse.body).includes('password'));
  assert.ok(!JSON.stringify(meResponse.body).includes('password'));
});

test('verifying a seeded hashPassword value works end to end for login', () => {
  const { adapter, crypto, router } = setup();
  const stored = hashPassword('secret', crypto);
  adapter.appendRow('users', { id: 1, email: 'seed@example.com', password: stored, created_at: 1, updated_at: 1, deleted_at: null });

  const response = router.dispatch(
    request({ path: '/login', method: 'POST', body: { email: 'seed@example.com', password: 'secret' } }),
  );

  assert.equal(response.status, 200);
});

test('createUser stores the username', () => {
  const { adapter, crypto } = setup();

  const user = createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);

  assert.equal(user.username, 'ana');
  assert.equal(adapter.getRows('users')[0].username, 'ana');
});

test('POST /me returns the username of the logged-in user', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);
  const loginResponse = router.dispatch(
    request({ path: '/login', method: 'POST', body: { email: 'ana@example.com', password: 'secret' } }),
  );
  const token = (loginResponse.body as { token: string }).token;

  const response = router.dispatch(request({ path: '/me', method: 'POST', body: { token } }));

  assert.equal((response.body as { username?: string }).username, 'ana');
});

test('createUser rejects a duplicate username without writing', () => {
  const { adapter, crypto } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);

  assert.throws(
    () => createUser(adapter, crypto, 'other@example.com', 'secret', 'ana', NOW),
    /Username already taken/,
  );
  assert.equal(adapter.getRows('users').length, 1);
});
