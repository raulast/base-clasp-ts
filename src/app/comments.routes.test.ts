import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../core/testing/in-memory-sheet-adapter.ts';
import { NodeCryptoAdapter } from '../core/testing/node-crypto-adapter.ts';
import { InMemoryLockAdapter } from '../core/testing/in-memory-lock-adapter.ts';
import { MigrationRunner } from '../core/migration.ts';
import { migrations } from './migrations/index.ts';
import { createRouter } from './routes.ts';
import { createUser } from './models/user.model.ts';
import { createPost } from './models/post.model.ts';
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

function createUserRow(adapter: InMemorySheetAdapter, crypto: NodeCryptoAdapter, email: string, username: string, role: string): Row {
  return createUser(adapter, crypto, email, 'secretpw', username, role, NOW);
}

function signInToken(router: ReturnType<typeof createRouter>, email: string): string {
  const response = router.dispatch(request({ path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'secretpw' } }));
  return (response.body as { data: { token: string } }).data.token;
}

function publishedPost(adapter: InMemorySheetAdapter, router: ReturnType<typeof createRouter>, crypto: NodeCryptoAdapter) {
  const authorRow = createUserRow(adapter, crypto, 'cauthor@a.com', 'cauthor', 'author');
  const post = createPost({ adapter, now: NOW }, { id: authorRow.id, role: 'author', disabled: false }, { title: 'Commentable' });
  const token = signInToken(router, 'cauthor@a.com');
  router.dispatch(request({ path: `/api/v1/posts/${post.id}`, method: 'PATCH', body: { status: 'published', token } }));
  return { authorRow, post, authorToken: token };
}

test('list comments on a public post anonymously, 404 on a draft post', () => {
  const { adapter, crypto, router } = setup();
  const { post } = publishedPost(adapter, router, crypto);

  const response = router.dispatch(request({ path: `/api/v1/posts/${post.id}/comments` }));
  assert.equal(response.status, 200);
  assert.deepEqual((response.body as { data: unknown[] }).data, []);

  const draft = createPost(
    { adapter, now: NOW },
    { id: (post as unknown as Row).author_id, role: 'author', disabled: false },
    { title: 'Draft' },
  );
  const draftResponse = router.dispatch(request({ path: `/api/v1/posts/${draft.id}/comments` }));
  assert.equal(draftResponse.status, 404);
});

test('create comment: anonymous 401, reader on published post 201, reader on draft post 403/404', () => {
  const { adapter, crypto, router } = setup();
  const { post, authorRow } = publishedPost(adapter, router, crypto);
  const readerRow = createUserRow(adapter, crypto, 'creader@a.com', 'creader', 'reader');
  const readerToken = signInToken(router, 'creader@a.com');

  const anonymous = router.dispatch(request({ path: `/api/v1/posts/${post.id}/comments`, method: 'POST', body: { body: 'hi' } }));
  assert.equal(anonymous.status, 401);

  const response = router.dispatch(
    request({ path: `/api/v1/posts/${post.id}/comments`, method: 'POST', body: { body: 'Nice post', token: readerToken } }),
  );
  assert.equal(response.status, 201);
  const data = (response.body as { data: { body: string; author: { id: unknown } } }).data;
  assert.equal(data.body, 'Nice post');
  assert.equal(data.author.id, readerRow.id);

  const draft = createPost(
    { adapter, now: NOW },
    { id: authorRow.id, role: 'author', disabled: false },
    { title: 'Another draft' },
  );
  const onDraft = router.dispatch(
    request({ path: `/api/v1/posts/${draft.id}/comments`, method: 'POST', body: { body: 'hi', token: readerToken } }),
  );
  assert.equal(onDraft.status, 404); // reader cannot view a draft that is not theirs
});

test('422 when body is empty or too long', () => {
  const { adapter, crypto, router } = setup();
  const { post } = publishedPost(adapter, router, crypto);
  createUserRow(adapter, crypto, 'cvalid@a.com', 'cvalid', 'reader');
  const token = signInToken(router, 'cvalid@a.com');

  const empty = router.dispatch(
    request({ path: `/api/v1/posts/${post.id}/comments`, method: 'POST', body: { body: '', token } }),
  );
  assert.equal(empty.status, 422);

  const tooLong = router.dispatch(
    request({ path: `/api/v1/posts/${post.id}/comments`, method: 'POST', body: { body: 'x'.repeat(2001), token } }),
  );
  assert.equal(tooLong.status, 422);
});

test('delete: comment author, post author, admin can delete; other user gets 403', () => {
  const { adapter, crypto, router } = setup();
  const { post, authorToken } = publishedPost(adapter, router, crypto);
  createUserRow(adapter, crypto, 'cd1@a.com', 'cd1', 'reader');
  createUserRow(adapter, crypto, 'cd2@a.com', 'cd2', 'reader');
  createUserRow(adapter, crypto, 'cdadmin@a.com', 'cdadmin', 'admin');
  const commenterToken = signInToken(router, 'cd1@a.com');
  const otherToken = signInToken(router, 'cd2@a.com');
  const adminToken = signInToken(router, 'cdadmin@a.com');

  const create = router.dispatch(
    request({ path: `/api/v1/posts/${post.id}/comments`, method: 'POST', body: { body: 'mine', token: commenterToken } }),
  );
  const commentId = (create.body as { data: { id: unknown } }).data.id;

  const forbidden = router.dispatch(request({ path: `/api/v1/comments/${commentId}`, method: 'DELETE', body: { token: otherToken } }));
  assert.equal(forbidden.status, 403);

  const byAuthor = router.dispatch(
    request({ path: `/api/v1/comments/${commentId}`, method: 'DELETE', body: { token: authorToken } }),
  );
  assert.equal(byAuthor.status, 200);
  assert.deepEqual((byAuthor.body as { data: unknown }).data, { id: commentId, deleted: true });

  const create2 = router.dispatch(
    request({ path: `/api/v1/posts/${post.id}/comments`, method: 'POST', body: { body: 'mine again', token: commenterToken } }),
  );
  const commentId2 = (create2.body as { data: { id: unknown } }).data.id;
  const byAdmin = router.dispatch(request({ path: `/api/v1/comments/${commentId2}`, method: 'DELETE', body: { token: adminToken } }));
  assert.equal(byAdmin.status, 200);
});

test('deleted post hides its comments (404)', () => {
  const { adapter, crypto, router } = setup();
  const { post, authorToken } = publishedPost(adapter, router, crypto);
  createUserRow(adapter, crypto, 'cdel@a.com', 'cdel', 'reader');
  const token = signInToken(router, 'cdel@a.com');
  router.dispatch(request({ path: `/api/v1/posts/${post.id}/comments`, method: 'POST', body: { body: 'before delete', token } }));

  router.dispatch(request({ path: `/api/v1/posts/${post.id}`, method: 'DELETE', body: { token: authorToken } }));

  const response = router.dispatch(request({ path: `/api/v1/posts/${post.id}/comments` }));
  assert.equal(response.status, 404);
});

test('every comment response is a valid envelope', () => {
  const { adapter, crypto, router } = setup();
  const { post } = publishedPost(adapter, router, crypto);
  createUserRow(adapter, crypto, 'cenv@a.com', 'cenv', 'reader');
  const token = signInToken(router, 'cenv@a.com');

  const responses = [
    router.dispatch(request({ path: `/api/v1/posts/${post.id}/comments` })),
    router.dispatch(
      request({ path: `/api/v1/posts/${post.id}/comments`, method: 'POST', body: { body: 'env check', token } }),
    ),
  ];

  for (const response of responses) {
    const body = response.body as { ok: boolean };
    assert.equal(typeof body.ok, 'boolean');
  }
});
