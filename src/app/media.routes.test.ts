import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../core/testing/in-memory-sheet-adapter.ts';
import { InMemoryStorageAdapter } from '../core/testing/in-memory-storage-adapter.ts';
import { NodeCryptoAdapter } from '../core/testing/node-crypto-adapter.ts';
import { InMemoryLockAdapter } from '../core/testing/in-memory-lock-adapter.ts';
import { MigrationRunner } from '../core/migration.ts';
import { migrations } from './migrations/index.ts';
import { createRouter } from './routes.ts';
import { createUser } from './models/user.model.ts';
import type { Request } from '../core/router.ts';
import type { Row } from '../core/sheet-adapter.ts';

const SECRET = 'test-secret';
const NOW = () => new Date(1700000000000);
const FOLDER_ID = 'folder-1';
const PNG_BASE64 = Buffer.from('tiny-png-bytes').toString('base64');

function setup() {
  const adapter = new InMemorySheetAdapter();
  new MigrationRunner(migrations, adapter, 'migrations', NOW).migrate();
  const crypto = new NodeCryptoAdapter();
  const lock = new InMemoryLockAdapter();
  const storage = new InMemoryStorageAdapter();
  const router = createRouter({ adapter, crypto, getSecret: () => SECRET, now: NOW, lock, storage, getMediaFolderId: () => FOLDER_ID });
  return { adapter, crypto, lock, storage, router };
}

function request(overrides: Partial<Request> = {}): Request {
  return { path: '/', method: 'GET', params: {}, body: {}, ...overrides };
}

function createUserRow(adapter: InMemorySheetAdapter, crypto: NodeCryptoAdapter, email: string, username: string, role: string): Row {
  return createUser(adapter, crypto, email, 'secretpw', username, role, NOW);
}

function signInToken(router: ReturnType<typeof createRouter>, email: string): string {
  const response = router.dispatch(request({ path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'secretpw' } }));
  return (response.body as { data: { token: string } }).data.token;
}

function createPostAs(router: ReturnType<typeof createRouter>, token: string, overrides: Record<string, unknown> = {}): { id: unknown } {
  const response = router.dispatch(
    request({ path: '/api/v1/posts', method: 'POST', body: { title: 'Post title', token, ...overrides } }),
  );
  return (response.body as { data: { id: unknown } }).data;
}

function publish(router: ReturnType<typeof createRouter>, id: unknown, token: string): void {
  router.dispatch(request({ path: `/api/v1/posts/${id}`, method: 'PATCH', body: { status: 'published', token } }));
}

test('uploading media returns an envelope with links once the post is published+public', () => {
  const { adapter, crypto, router } = setup();
  createUserRow(adapter, crypto, 'author@a.com', 'author1', 'author');
  const token = signInToken(router, 'author@a.com');
  const post = createPostAs(router, token);

  const response = router.dispatch(
    request({
      path: `/api/v1/posts/${post.id}/media`,
      method: 'POST',
      body: { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64, token },
    }),
  );
  const body = response.body as { ok: boolean; status: number; data: { url?: string } };
  assert.equal(body.ok, true);
  assert.equal(body.status, 201);
  assert.equal(body.data.url, undefined, 'draft post stays private');

  publish(router, post.id, token);
  const listResponse = router.dispatch(request({ path: `/api/v1/posts/${post.id}/media` }));
  const listBody = listResponse.body as { data: Array<{ url?: string }> };
  assert.ok(listBody.data[0].url);
});

test('anonymous upload is 401, reader upload is 403, missing post is 404', () => {
  const { adapter, crypto, router } = setup();
  createUserRow(adapter, crypto, 'author@a.com', 'author2', 'author');
  const authorToken = signInToken(router, 'author@a.com');
  const post = createPostAs(router, authorToken);
  publish(router, post.id, authorToken);
  createUserRow(adapter, crypto, 'reader@a.com', 'reader1', 'reader');
  const readerToken = signInToken(router, 'reader@a.com');

  const anonymous = router.dispatch(
    request({ path: `/api/v1/posts/${post.id}/media`, method: 'POST', body: { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64 } }),
  );
  assert.equal(anonymous.status, 401);

  const asReader = router.dispatch(
    request({
      path: `/api/v1/posts/${post.id}/media`,
      method: 'POST',
      body: { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64, token: readerToken },
    }),
  );
  assert.equal(asReader.status, 403);

  const missingPost = router.dispatch(
    request({ path: '/api/v1/posts/999999/media', method: 'POST', body: { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64, token: authorToken } }),
  );
  assert.equal(missingPost.status, 404);
});

test('oversized upload is 413 and unsupported mime type is 415', () => {
  const { adapter, crypto, router } = setup();
  createUserRow(adapter, crypto, 'author@a.com', 'author3', 'author');
  const token = signInToken(router, 'author@a.com');
  const post = createPostAs(router, token);

  const oversized = router.dispatch(
    request({
      path: `/api/v1/posts/${post.id}/media`,
      method: 'POST',
      body: { name: 'a.png', mimeType: 'image/png', data: 'A'.repeat(3 * 1024 * 1024), token },
    }),
  );
  assert.equal(oversized.status, 413);

  const unsupported = router.dispatch(
    request({
      path: `/api/v1/posts/${post.id}/media`,
      method: 'POST',
      body: { name: 'a.exe', mimeType: 'application/x-msdownload', data: PNG_BASE64, token },
    }),
  );
  assert.equal(unsupported.status, 415);
});

test('invalid upload body is 422', () => {
  const { adapter, crypto, router } = setup();
  createUserRow(adapter, crypto, 'author@a.com', 'author4', 'author');
  const token = signInToken(router, 'author@a.com');
  const post = createPostAs(router, token);

  const response = router.dispatch(
    request({ path: `/api/v1/posts/${post.id}/media`, method: 'POST', body: { name: '', mimeType: 'image/png', data: PNG_BASE64, token } }),
  );
  assert.equal(response.status, 422);
});

test('protected media is returned as base64 to an authorized reader via POST + _method GET, and 404 to anonymous', () => {
  const { adapter, crypto, router } = setup();
  createUserRow(adapter, crypto, 'author@a.com', 'author5', 'author');
  const authorToken = signInToken(router, 'author@a.com');
  const post = createPostAs(router, authorToken, { visibility: 'members' });
  publish(router, post.id, authorToken);
  const uploadResponse = router.dispatch(
    request({
      path: `/api/v1/posts/${post.id}/media`,
      method: 'POST',
      body: { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64, token: authorToken },
    }),
  );
  const mediaId = (uploadResponse.body as { data: { id: unknown } }).data.id;

  createUserRow(adapter, crypto, 'reader@a.com', 'reader2', 'reader');
  const readerToken = signInToken(router, 'reader@a.com');
  const asReader = router.dispatch(
    request({ path: `/api/v1/media/${mediaId}`, method: 'POST', body: { _method: 'GET', token: readerToken, download: true } }),
  );
  const readerBody = asReader.body as { data: { data?: string } };
  assert.equal(readerBody.data.data, PNG_BASE64);

  const anonymous = router.dispatch(request({ path: `/api/v1/media/${mediaId}` }));
  assert.equal(anonymous.status, 404);
});

test('deleting media trashes the Drive file and is restricted to the owner/admin', () => {
  const { adapter, crypto, storage, router } = setup();
  createUserRow(adapter, crypto, 'author@a.com', 'author6', 'author');
  const token = signInToken(router, 'author@a.com');
  const post = createPostAs(router, token);
  publish(router, post.id, token);
  const uploadResponse = router.dispatch(
    request({ path: `/api/v1/posts/${post.id}/media`, method: 'POST', body: { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64, token } }),
  );
  const mediaId = (uploadResponse.body as { data: { id: unknown } }).data.id;

  createUserRow(adapter, crypto, 'other@a.com', 'other1', 'author');
  const otherToken = signInToken(router, 'other@a.com');
  const forbidden = router.dispatch(request({ path: `/api/v1/media/${mediaId}`, method: 'DELETE', body: { token: otherToken } }));
  assert.equal(forbidden.status, 403);

  const response = router.dispatch(request({ path: `/api/v1/media/${mediaId}`, method: 'DELETE', body: { token } }));
  const body = response.body as { data: { deleted: boolean } };
  assert.equal(body.data.deleted, true);
  assert.equal([...storage.files.values()][0].trashed, true);
});

test('deleting the post unshares its media, and no media response contains drive_file_id', () => {
  const { adapter, crypto, router } = setup();
  createUserRow(adapter, crypto, 'author@a.com', 'author7', 'author');
  const token = signInToken(router, 'author@a.com');
  const post = createPostAs(router, token);
  publish(router, post.id, token);
  const uploadResponse = router.dispatch(
    request({ path: `/api/v1/posts/${post.id}/media`, method: 'POST', body: { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64, token } }),
  );
  const mediaBody = uploadResponse.body as { data: Record<string, unknown> };
  assert.equal(mediaBody.data.drive_file_id, undefined);
  assert.equal(mediaBody.data.owner_id, undefined);

  router.dispatch(request({ path: `/api/v1/posts/${post.id}`, method: 'DELETE', body: { token } }));

  const listAsAdmin = router.dispatch(
    request({ path: `/api/v1/posts/${post.id}/media`, method: 'POST', body: { _method: 'GET', token } }),
  );
  assert.equal(listAsAdmin.status, 404, 'the post is gone, so its media list is no longer viewable');
});

test('every media response is a valid envelope', () => {
  const { adapter, crypto, router } = setup();
  createUserRow(adapter, crypto, 'author@a.com', 'author8', 'author');
  const token = signInToken(router, 'author@a.com');
  const post = createPostAs(router, token);

  const response = router.dispatch(
    request({ path: `/api/v1/posts/${post.id}/media`, method: 'POST', body: { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64, token } }),
  );
  const body = response.body as { ok: boolean; status: number };
  assert.equal(typeof body.ok, 'boolean');
  assert.equal(typeof body.status, 'number');
});

test('hostile media bodies get 4xx envelopes, never a 500', () => {
  const { adapter, crypto, router } = setup();
  createUserRow(adapter, crypto, 'author@a.com', 'author9', 'author');
  const token = signInToken(router, 'author@a.com');
  const post = createPostAs(router, token);

  for (const body of [{ data: 123 }, { data: ['a'] }, { name: { x: 1 } }, { mimeType: null }]) {
    const response = router.dispatch(
      request({
        path: `/api/v1/posts/${post.id}/media`,
        method: 'POST',
        body: { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64, ...body, token },
      }),
    );
    assert.equal(response.status, 422, JSON.stringify(body));
  }

  const uploaded = router.dispatch(
    request({ path: `/api/v1/posts/${post.id}/media`, method: 'POST', body: { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64, token } }),
  );
  const mediaId = (uploaded.body as { data: { id: unknown } }).data.id;
  const shown = router.dispatch(
    request({ path: `/api/v1/media/${mediaId}`, method: 'POST', body: { _method: 'GET', download: { evil: true }, token } }),
  );
  assert.equal(shown.status, 200);
  assert.equal((shown.body as { data: { data?: string } }).data.data, undefined);

  const missing = router.dispatch(request({ path: '/api/v1/media/not-a-number' }));
  assert.equal(missing.status, 404);
});
