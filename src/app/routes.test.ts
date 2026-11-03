import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../core/testing/in-memory-sheet-adapter.ts';
import { NodeCryptoAdapter } from '../core/testing/node-crypto-adapter.ts';
import { createRouter } from './routes.ts';
import { createUser } from './models/user.model.ts';
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

const LOGIN_ERROR_MESSAGE = 'Invalid email or password';

test('POST /api/v1/auth/register creates a reader and returns a token envelope', () => {
  const { router } = setup();

  const response = router.dispatch(
    request({
      path: '/api/v1/auth/register',
      method: 'POST',
      body: { email: 'new@example.com', password: 'secretpw', username: 'newbie' },
    }),
  );

  assert.equal(response.status, 201);
  const body = response.body as { ok: boolean; data: { token?: string; user?: { role?: string; password?: string } } };
  assert.equal(body.ok, true);
  assert.ok(typeof body.data.user?.role === 'string');
  assert.equal(body.data.user?.role, 'reader');
  assert.ok(typeof body.data.token === 'string');
  assert.ok(!('password' in (body.data.user ?? {})));
});

test('POST /api/v1/auth/register ignores a role in the body and always creates a reader', () => {
  const { router } = setup();

  const response = router.dispatch(
    request({
      path: '/api/v1/auth/register',
      method: 'POST',
      body: { email: 'new@example.com', password: 'secretpw', username: 'newbie', role: 'admin' },
    }),
  );

  const body = response.body as { data: { user: { role: string } } };
  assert.equal(body.data.user.role, 'reader');
});

test('POST /api/v1/auth/login returns a token envelope for the right credentials', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);

  const response = router.dispatch(
    request({ path: '/api/v1/auth/login', method: 'POST', body: { email: 'ana@example.com', password: 'secretpw' } }),
  );

  assert.equal(response.status, 200);
  const body = response.body as { ok: boolean; data: { token?: string } };
  assert.equal(body.ok, true);
  assert.ok(typeof body.data.token === 'string');
});

test('POST /api/v1/auth/login returns the same error envelope for an unknown email and a wrong password', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);

  const unknownEmail = router.dispatch(
    request({ path: '/api/v1/auth/login', method: 'POST', body: { email: 'nobody@example.com', password: 'secretpw' } }),
  );
  const wrongPassword = router.dispatch(
    request({ path: '/api/v1/auth/login', method: 'POST', body: { email: 'ana@example.com', password: 'wrong' } }),
  );

  assert.equal(unknownEmail.status, 401);
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(unknownEmail.body, {
    ok: false,
    status: 401,
    error: { code: 'UNAUTHENTICATED', message: LOGIN_ERROR_MESSAGE },
  });
  assert.deepEqual(wrongPassword.body, {
    ok: false,
    status: 401,
    error: { code: 'UNAUTHENTICATED', message: LOGIN_ERROR_MESSAGE },
  });
});

test('GET /api/v1/auth/me returns the current user envelope for a valid token, without password', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);
  const loginResponse = router.dispatch(
    request({ path: '/api/v1/auth/login', method: 'POST', body: { email: 'ana@example.com', password: 'secretpw' } }),
  );
  const token = (loginResponse.body as { data: { token: string } }).data.token;

  const response = router.dispatch(
    request({ path: '/api/v1/auth/me', method: 'POST', body: { _method: 'GET', token } }),
  );

  assert.equal(response.status, 200);
  const body = response.body as { ok: boolean; data: { email: string } };
  assert.equal(body.ok, true);
  assert.equal(body.data.email, 'ana@example.com');
  assert.ok(!('password' in body.data));
});

test('GET /api/v1/auth/me without a body token is 401', () => {
  const { router } = setup();

  const response = router.dispatch(request({ path: '/api/v1/auth/me', method: 'GET' }));

  assert.equal(response.status, 401);
  assert.equal((response.body as { error: { code: string } }).error.code, 'UNAUTHENTICATED');
});

test('POST /api/v1/auth/me with _method GET and a token returns a 200 envelope', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);
  const loginResponse = router.dispatch(
    request({ path: '/api/v1/auth/login', method: 'POST', body: { email: 'ana@example.com', password: 'secretpw' } }),
  );
  const token = (loginResponse.body as { data: { token: string } }).data.token;

  const response = router.dispatch(
    request({ path: '/api/v1/auth/me', method: 'POST', body: { _method: 'GET', token } }),
  );

  assert.equal(response.status, 200);
  assert.equal((response.body as { ok: boolean }).ok, true);
});

test('GET /api/v1/auth/me with a tampered token is 401', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);
  const loginResponse = router.dispatch(
    request({ path: '/api/v1/auth/login', method: 'POST', body: { email: 'ana@example.com', password: 'secretpw' } }),
  );
  const token = (loginResponse.body as { data: { token: string } }).data.token;
  const tampered = token.slice(0, -2) + 'xx';

  const response = router.dispatch(
    request({ path: '/api/v1/auth/me', method: 'POST', body: { _method: 'GET', token: tampered } }),
  );

  assert.equal(response.status, 401);
});

test('the old /login and /me API routes are removed (/login is now a GET-only page)', () => {
  const { router } = setup();

  const login = router.dispatch(request({ path: '/login', method: 'POST', body: {} }));
  const me = router.dispatch(request({ path: '/me', method: 'POST', body: {} }));

  assert.equal(login.status, 405);
  assert.deepEqual((login.body as { error: { details?: { allowed?: string[] } } }).error.details, { allowed: ['GET'] });
  assert.equal(me.status, 404);
});

test('/api/v1/auth/me with the token only in params (not body) is 401', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);
  const loginResponse = router.dispatch(
    request({ path: '/api/v1/auth/login', method: 'POST', body: { email: 'ana@example.com', password: 'secretpw' } }),
  );
  const token = (loginResponse.body as { data: { token: string } }).data.token;

  const response = router.dispatch(
    request({ path: '/api/v1/auth/me', method: 'POST', body: { _method: 'GET' }, params: { token } }),
  );

  assert.equal(response.status, 401);
});

test('no response from login or me ever contains a password field', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);
  const loginResponse = router.dispatch(
    request({ path: '/api/v1/auth/login', method: 'POST', body: { email: 'ana@example.com', password: 'secretpw' } }),
  );
  const token = (loginResponse.body as { data: { token: string } }).data.token;
  const meResponse = router.dispatch(
    request({ path: '/api/v1/auth/me', method: 'POST', body: { _method: 'GET', token } }),
  );

  assert.ok(!JSON.stringify(loginResponse.body).includes('password'));
  assert.ok(!JSON.stringify(meResponse.body).includes('password'));
});

test('GET /api/v1/auth/me returns the username of the logged-in user', () => {
  const { adapter, crypto, router } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);
  const loginResponse = router.dispatch(
    request({ path: '/api/v1/auth/login', method: 'POST', body: { email: 'ana@example.com', password: 'secretpw' } }),
  );
  const token = (loginResponse.body as { data: { token: string } }).data.token;

  const response = router.dispatch(
    request({ path: '/api/v1/auth/me', method: 'POST', body: { _method: 'GET', token } }),
  );

  assert.equal((response.body as { data: { username?: string } }).data.username, 'ana');
});

function setupWithUrl() {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'username', 'password', 'created_at', 'updated_at', 'deleted_at']);
  const crypto = new NodeCryptoAdapter();
  const router = createRouter({
    adapter,
    crypto,
    getSecret: () => SECRET,
    now: NOW,
    getAppUrl: () => 'https://script.google.com/macros/s/ID/dev',
  });
  return { router };
}

test('GET / renders the home view with the app URL for navigation', () => {
  const { router } = setupWithUrl();

  const response = router.dispatch(request({ path: '/' }));

  assert.deepEqual(response.body, {
    kind: 'view',
    name: 'app/views/home',
    data: { appName: 'Gas Fullstack Core', appUrl: 'https://script.google.com/macros/s/ID/dev' },
  });
});

test('GET /login renders the login view with the app URL for navigation', () => {
  const { router } = setupWithUrl();

  const response = router.dispatch(request({ path: '/login' }));

  assert.deepEqual(response.body, {
    kind: 'view',
    name: 'app/views/login',
    data: { appName: 'Gas Fullstack Core', appUrl: 'https://script.google.com/macros/s/ID/dev' },
  });
});

test('GET /register renders the register view with the app URL for navigation', () => {
  const { router } = setupWithUrl();

  const response = router.dispatch(request({ path: '/register' }));

  assert.deepEqual(response.body, {
    kind: 'view',
    name: 'app/views/register',
    data: { appName: 'Gas Fullstack Core', appUrl: 'https://script.google.com/macros/s/ID/dev' },
  });
});

test('GET /posts/:slug renders the post view with the app URL and the slug param', () => {
  const { router } = setupWithUrl();

  const response = router.dispatch(request({ path: '/posts/hello-world' }));

  assert.deepEqual(response.body, {
    kind: 'view',
    name: 'app/views/post',
    data: { appName: 'Gas Fullstack Core', appUrl: 'https://script.google.com/macros/s/ID/dev', slug: 'hello-world' },
  });
});

test('GET /profile renders the profile view with the app URL for navigation', () => {
  const { router } = setupWithUrl();

  const response = router.dispatch(request({ path: '/profile' }));

  assert.deepEqual(response.body, {
    kind: 'view',
    name: 'app/views/profile',
    data: { appName: 'Gas Fullstack Core', appUrl: 'https://script.google.com/macros/s/ID/dev' },
  });
});

test('GET /dashboard renders the dashboard view with the app URL for navigation', () => {
  const { router } = setupWithUrl();

  const response = router.dispatch(request({ path: '/dashboard' }));

  assert.deepEqual(response.body, {
    kind: 'view',
    name: 'app/views/dashboard',
    data: { appName: 'Gas Fullstack Core', appUrl: 'https://script.google.com/macros/s/ID/dev' },
  });
});

test('GET /dashboard/posts/new renders the post editor view with an empty id', () => {
  const { router } = setupWithUrl();

  const response = router.dispatch(request({ path: '/dashboard/posts/new' }));

  assert.deepEqual(response.body, {
    kind: 'view',
    name: 'app/views/post-editor',
    data: { appName: 'Gas Fullstack Core', appUrl: 'https://script.google.com/macros/s/ID/dev', id: '' },
  });
});

test('GET /dashboard/posts/:id/edit renders the post editor view with the id param', () => {
  const { router } = setupWithUrl();

  const response = router.dispatch(request({ path: '/dashboard/posts/42/edit' }));

  assert.deepEqual(response.body, {
    kind: 'view',
    name: 'app/views/post-editor',
    data: { appName: 'Gas Fullstack Core', appUrl: 'https://script.google.com/macros/s/ID/dev', id: '42' },
  });
});

test('GET /admin/users renders the admin users view with the app URL for navigation', () => {
  const { router } = setupWithUrl();

  const response = router.dispatch(request({ path: '/admin/users' }));

  assert.deepEqual(response.body, {
    kind: 'view',
    name: 'app/views/admin-users',
    data: { appName: 'Gas Fullstack Core', appUrl: 'https://script.google.com/macros/s/ID/dev' },
  });
});

test('GET /admin/tags renders the admin tags view with the app URL for navigation', () => {
  const { router } = setupWithUrl();

  const response = router.dispatch(request({ path: '/admin/tags' }));

  assert.deepEqual(response.body, {
    kind: 'view',
    name: 'app/views/admin-tags',
    data: { appName: 'Gas Fullstack Core', appUrl: 'https://script.google.com/macros/s/ID/dev' },
  });
});
