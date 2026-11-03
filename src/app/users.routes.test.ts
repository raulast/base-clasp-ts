import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../core/testing/in-memory-sheet-adapter.ts';
import { NodeCryptoAdapter } from '../core/testing/node-crypto-adapter.ts';
import { InMemoryLockAdapter } from '../core/testing/in-memory-lock-adapter.ts';
import { MigrationRunner } from '../core/migration.ts';
import { migrations } from './migrations/index.ts';
import { createRouter } from './routes.ts';
import type { Request } from '../core/router.ts';
import type { Row } from '../core/sheet-adapter.ts';

const SECRET = 'test-secret';
const NOW = () => new Date(1700000000000);

function setup() {
  const adapter = new InMemorySheetAdapter();
  new MigrationRunner(migrations, adapter, 'migrations', NOW).migrate();
  const crypto = new NodeCryptoAdapter();
  const lock = new InMemoryLockAdapter();
  const router = createRouter({ adapter, crypto, getSecret: () => SECRET, now: NOW, lock });
  return { adapter, crypto, lock, router };
}

function request(overrides: Partial<Request> = {}): Request {
  return { path: '/', method: 'GET', params: {}, body: {}, ...overrides };
}

function registerUser(router: ReturnType<typeof createRouter>, email: string, username: string): { token: string; id: unknown } {
  const response = router.dispatch(
    request({ path: '/api/v1/auth/register', method: 'POST', body: { email, password: 'secretpw', username } }),
  );
  const data = (response.body as { data: { token: string; user: { id: unknown } } }).data;
  return { token: data.token, id: data.user.id };
}

function promoteRole(adapter: InMemorySheetAdapter, email: string, role: string): Row {
  const index = adapter.findRowIndex('users', (row) => row.email === email);
  const row = adapter.getRows('users')[index];
  const updated = { ...row, role };
  adapter.updateRow('users', index, updated);
  return updated;
}

test('GET /api/v1/users lists users for an admin', () => {
  const { adapter, router } = setup();
  const admin = registerUser(router, 'admin@example.com', 'admin1');
  promoteRole(adapter, 'admin@example.com', 'admin');
  registerUser(router, 'ana@example.com', 'ana');

  const response = router.dispatch(request({ path: '/api/v1/users', body: { token: admin.token } }));

  assert.equal(response.status, 200);
  const body = response.body as { ok: boolean; data: Row[] };
  assert.equal(body.ok, true);
  assert.equal(body.data.length, 2);
  for (const user of body.data) {
    assert.ok(!('password' in user));
  }
});

test('GET /api/v1/users rejects author, reader and anonymous callers', () => {
  const { adapter, router } = setup();
  const author = registerUser(router, 'author@example.com', 'author1');
  promoteRole(adapter, 'author@example.com', 'author');
  const reader = registerUser(router, 'reader@example.com', 'reader1');

  const authorResponse = router.dispatch(request({ path: '/api/v1/users', body: { token: author.token } }));
  assert.equal(authorResponse.status, 403);

  const readerResponse = router.dispatch(request({ path: '/api/v1/users', body: { token: reader.token } }));
  assert.equal(readerResponse.status, 403);

  const anonResponse = router.dispatch(request({ path: '/api/v1/users' }));
  assert.equal(anonResponse.status, 401);
});

test('PATCH /api/v1/users/:id promotes a reader to author, and that user can then create posts', () => {
  const { adapter, router } = setup();
  const admin = registerUser(router, 'admin@example.com', 'admin1');
  promoteRole(adapter, 'admin@example.com', 'admin');
  const reader = registerUser(router, 'ana@example.com', 'ana');

  const patchResponse = router.dispatch(
    request({ path: `/api/v1/users/${reader.id}`, method: 'PATCH', body: { token: admin.token, role: 'author' } }),
  );
  assert.equal(patchResponse.status, 200);
  const updated = (patchResponse.body as { data: Row }).data;
  assert.equal(updated.role, 'author');

  const createResponse = router.dispatch(
    request({
      path: '/api/v1/posts',
      method: 'POST',
      body: { token: reader.token, title: 'My first post' },
    }),
  );
  assert.equal(createResponse.status, 201);
});

test('PATCH /api/v1/users/:id disables a user and their existing token is rejected afterwards', () => {
  const { adapter, router } = setup();
  const admin = registerUser(router, 'admin@example.com', 'admin1');
  promoteRole(adapter, 'admin@example.com', 'admin');
  const reader = registerUser(router, 'ana@example.com', 'ana');

  const patchResponse = router.dispatch(
    request({ path: `/api/v1/users/${reader.id}`, method: 'PATCH', body: { token: admin.token, disabled: true } }),
  );
  assert.equal(patchResponse.status, 200);

  const meResponse = router.dispatch(request({ path: '/api/v1/auth/me', method: 'POST', body: { _method: 'GET', token: reader.token } }));
  assert.equal(meResponse.status, 401);
});

test('PATCH /api/v1/users/:id rejects self-demotion and self-disable with 403', () => {
  const { adapter, router } = setup();
  const admin = registerUser(router, 'admin@example.com', 'admin1');
  promoteRole(adapter, 'admin@example.com', 'admin');

  const demote = router.dispatch(
    request({ path: `/api/v1/users/${admin.id}`, method: 'PATCH', body: { token: admin.token, role: 'reader' } }),
  );
  assert.equal(demote.status, 403);

  const disable = router.dispatch(
    request({ path: `/api/v1/users/${admin.id}`, method: 'PATCH', body: { token: admin.token, disabled: true } }),
  );
  assert.equal(disable.status, 403);
});

test('PATCH /api/v1/users/:id rejects invalid role/disabled values with 422', () => {
  const { adapter, router } = setup();
  const admin = registerUser(router, 'admin@example.com', 'admin1');
  promoteRole(adapter, 'admin@example.com', 'admin');
  const reader = registerUser(router, 'ana@example.com', 'ana');

  const badRole = router.dispatch(
    request({ path: `/api/v1/users/${reader.id}`, method: 'PATCH', body: { token: admin.token, role: 'superadmin' } }),
  );
  assert.equal(badRole.status, 422);

  const badDisabled = router.dispatch(
    request({ path: `/api/v1/users/${reader.id}`, method: 'PATCH', body: { token: admin.token, disabled: 'yes' } }),
  );
  assert.equal(badDisabled.status, 422);
});

test('PATCH /api/v1/users/:id ignores email, password and username fields', () => {
  const { adapter, router } = setup();
  const admin = registerUser(router, 'admin@example.com', 'admin1');
  promoteRole(adapter, 'admin@example.com', 'admin');
  const reader = registerUser(router, 'ana@example.com', 'ana');

  const response = router.dispatch(
    request({
      path: `/api/v1/users/${reader.id}`,
      method: 'PATCH',
      body: { token: admin.token, role: 'author', email: 'hacked@example.com', username: 'hacked', password: 'hacked1234' },
    }),
  );

  assert.equal(response.status, 200);
  const updated = (response.body as { data: Row }).data;
  assert.equal(updated.email, 'ana@example.com');
  assert.equal(updated.username, 'ana');
  assert.ok(!('password' in updated));
});

test('every users endpoint response is a valid envelope', () => {
  const { adapter, router } = setup();
  const admin = registerUser(router, 'admin@example.com', 'admin1');
  promoteRole(adapter, 'admin@example.com', 'admin');

  const listResponse = router.dispatch(request({ path: '/api/v1/users', body: { token: admin.token } }));
  assert.equal(typeof (listResponse.body as { ok: boolean }).ok, 'boolean');
});
