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
import { createTag } from './models/tag.model.ts';
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

function registerUser(router: ReturnType<typeof createRouter>, email: string, username: string): string {
  const response = router.dispatch(
    request({ path: '/api/v1/auth/register', method: 'POST', body: { email, password: 'secretpw', username } }),
  );
  return (response.body as { data: { token: string } }).data.token;
}

function promoteRole(adapter: InMemorySheetAdapter, email: string, role: string): Row {
  const index = adapter.findRowIndex('users', (row) => row.email === email);
  const row = adapter.getRows('users')[index];
  const updated = { ...row, role };
  adapter.updateRow('users', index, updated);
  return updated;
}

function registerAs(
  setupResult: { adapter: InMemorySheetAdapter; router: ReturnType<typeof createRouter> },
  email: string,
  username: string,
  role: 'author' | 'admin' | 'reader',
): string {
  const token = registerUser(setupResult.router, email, username);
  if (role !== 'reader') {
    promoteRole(setupResult.adapter, email, role);
  }
  return token;
}

function createUserRow(adapter: InMemorySheetAdapter, crypto: NodeCryptoAdapter, email: string, username: string, role: string): Row {
  return createUser(adapter, crypto, email, 'secretpw', username, role, NOW);
}

test('anonymous sees only published+public posts in the list', () => {
  const { adapter, crypto, router } = setup();
  const authorRow = createUserRow(adapter, crypto, 'author@a.com', 'author1', 'author');
  const postDeps = { adapter, now: NOW };
  const published = createPost(postDeps, { id: authorRow.id, role: 'author', disabled: false }, { title: 'Published public' });
  const _ = createPost(postDeps, { id: authorRow.id, role: 'author', disabled: false }, { title: 'Still draft' });
  // Promote the published post.
  const postsResponse = router.dispatch(request({ path: '/api/v1/posts' }));
  const bodyBefore = (postsResponse.body as { data: unknown[] }).data;
  assert.equal(bodyBefore.length, 0);

  router.dispatch(
    request({
      path: `/api/v1/posts/${published.id}`,
      method: 'PATCH',
      body: { status: 'published', token: signInToken(router, adapter, crypto, 'author@a.com') },
    }),
  );

  const response = router.dispatch(request({ path: '/api/v1/posts' }));
  const body = response.body as { data: Array<{ title: string }> };
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].title, 'Published public');
});

function signInToken(router: ReturnType<typeof createRouter>, adapter: InMemorySheetAdapter, crypto: NodeCryptoAdapter, email: string): string {
  const response = router.dispatch(
    request({ path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'secretpw' } }),
  );
  return (response.body as { data: { token: string } }).data.token;
}

test('reader also sees published members posts; others draft/private stay hidden', () => {
  const { adapter, crypto, router } = setup();
  const authorRow = createUserRow(adapter, crypto, 'author2@a.com', 'author2', 'author');
  const readerToken = (() => {
    createUserRow(adapter, crypto, 'reader1@a.com', 'reader1', 'reader');
    return signInToken(router, adapter, crypto, 'reader1@a.com');
  })();
  const postDeps = { adapter, now: NOW };
  const membersPost = createPost(
    postDeps,
    { id: authorRow.id, role: 'author', disabled: false },
    { title: 'Members post', visibility: 'members' },
  );
  const authorToken = signInToken(router, adapter, crypto, 'author2@a.com');
  router.dispatch(
    request({ path: `/api/v1/posts/${membersPost.id}`, method: 'PATCH', body: { status: 'published', token: authorToken } }),
  );
  const privatePost = createPost(
    postDeps,
    { id: authorRow.id, role: 'author', disabled: false },
    { title: 'Private post', visibility: 'private' },
  );
  router.dispatch(
    request({ path: `/api/v1/posts/${privatePost.id}`, method: 'PATCH', body: { status: 'published', token: authorToken } }),
  );

  const asReaderResponse = router.dispatch(
    request({ path: '/api/v1/posts', method: 'POST', body: { _method: 'GET', token: readerToken } }),
  );
  const asReaderBody = asReaderResponse.body as { data: Array<{ title: string }> };
  assert.equal(asReaderBody.data.length, 1);
  assert.equal(asReaderBody.data[0].title, 'Members post');
});

test('author sees own drafts and private posts in the list', () => {
  const { adapter, crypto, router } = setup();
  const authorRow = createUserRow(adapter, crypto, 'author3@a.com', 'author3', 'author');
  const postDeps = { adapter, now: NOW };
  createPost(postDeps, { id: authorRow.id, role: 'author', disabled: false }, { title: 'Draft post' });
  createPost(postDeps, { id: authorRow.id, role: 'author', disabled: false }, { title: 'Private post', visibility: 'private' });
  const token = signInToken(router, adapter, crypto, 'author3@a.com');

  const response = router.dispatch(request({ path: '/api/v1/posts', method: 'POST', body: { _method: 'GET', token } }));
  const body = response.body as { data: Array<{ title: string }> };
  assert.equal(body.data.length, 2);
});

test('tag and author filters and pagination meta', () => {
  const { adapter, crypto, router } = setup();
  const authorRow = createUserRow(adapter, crypto, 'author4@a.com', 'author4', 'author');
  createTag(adapter, 'News', NOW);
  const postDeps = { adapter, now: NOW };
  const post1 = createPost(postDeps, { id: authorRow.id, role: 'author', disabled: false }, { title: 'A', tags: ['news'] });
  createPost(postDeps, { id: authorRow.id, role: 'author', disabled: false }, { title: 'B' });
  const token = signInToken(router, adapter, crypto, 'author4@a.com');

  const byTag = router.dispatch(
    request({ path: '/api/v1/posts', method: 'POST', body: { _method: 'GET', token, tag: 'news' } }),
  );
  const byTagBody = byTag.body as { data: Array<{ id: unknown }> };
  assert.equal(byTagBody.data.length, 1);
  assert.equal(byTagBody.data[0].id, post1.id);

  const byAuthor = router.dispatch(
    request({ path: '/api/v1/posts', method: 'POST', body: { _method: 'GET', token, author: String(authorRow.id) } }),
  );
  const byAuthorBody = byAuthor.body as { data: unknown[] };
  assert.equal(byAuthorBody.data.length, 2);

  const paged = router.dispatch(
    request({ path: '/api/v1/posts', method: 'POST', body: { _method: 'GET', token, perPage: 1, page: 2 } }),
  );
  const pagedBody = paged.body as { meta: { page: number; perPage: number; total: number; pages: number } };
  assert.equal(pagedBody.meta.page, 2);
  assert.equal(pagedBody.meta.perPage, 1);
  assert.equal(pagedBody.meta.total, 2);
  assert.equal(pagedBody.meta.pages, 2);
});

test('show by id and by slug; others draft/private returns 404 (no existence leak)', () => {
  const { adapter, crypto, router } = setup();
  const authorRow = createUserRow(adapter, crypto, 'author5@a.com', 'author5', 'author');
  const postDeps = { adapter, now: NOW };
  const post = createPost(postDeps, { id: authorRow.id, role: 'author', disabled: false }, { title: 'Findable Post' });

  const byId = router.dispatch(request({ path: `/api/v1/posts/${post.id}` }));
  assert.equal(byId.status, 404); // still a draft, anonymous cannot view

  const otherAuthorRow = createUserRow(adapter, crypto, 'author6@a.com', 'author6', 'author');
  const otherToken = signInToken(router, adapter, crypto, 'author6@a.com');
  const otherSees = router.dispatch(
    request({ path: `/api/v1/posts/${post.id}`, method: 'POST', body: { _method: 'GET', token: otherToken } }),
  );
  assert.equal(otherSees.status, 404);

  const ownerToken = signInToken(router, adapter, crypto, 'author5@a.com');
  router.dispatch(
    request({ path: `/api/v1/posts/${post.id}`, method: 'PATCH', body: { status: 'published', token: ownerToken } }),
  );

  const byIdPublished = router.dispatch(request({ path: `/api/v1/posts/${post.id}` }));
  assert.equal(byIdPublished.status, 200);
  const bySlug = router.dispatch(request({ path: `/api/v1/posts/${post.slug}` }));
  assert.equal(bySlug.status, 200);
  assert.equal((bySlug.body as { data: { id: unknown } }).data.id, post.id);
  void otherAuthorRow;
});

test('editing a viewable post that is not yours is 403', () => {
  const { adapter, crypto, router } = setup();
  const authorRow = createUserRow(adapter, crypto, 'author7@a.com', 'author7', 'author');
  const otherRow = createUserRow(adapter, crypto, 'author8@a.com', 'author8', 'author');
  const postDeps = { adapter, now: NOW };
  const post = createPost(postDeps, { id: authorRow.id, role: 'author', disabled: false }, { title: 'Owned' });
  const ownerToken = signInToken(router, adapter, crypto, 'author7@a.com');
  router.dispatch(request({ path: `/api/v1/posts/${post.id}`, method: 'PATCH', body: { status: 'published', token: ownerToken } }));

  const otherToken = signInToken(router, adapter, crypto, 'author8@a.com');
  const response = router.dispatch(
    request({ path: `/api/v1/posts/${post.id}`, method: 'PATCH', body: { title: 'Hijacked', token: otherToken } }),
  );

  assert.equal(response.status, 403);
  void otherRow;
});

test('reader create is 403; anonymous create is 401', () => {
  const { adapter, crypto, router } = setup();
  createUserRow(adapter, crypto, 'reader2@a.com', 'reader2', 'reader');
  const readerToken = signInToken(router, adapter, crypto, 'reader2@a.com');

  const asReader = router.dispatch(
    request({ path: '/api/v1/posts', method: 'POST', body: { title: 'Nope', token: readerToken } }),
  );
  assert.equal(asReader.status, 403);

  const anonymous = router.dispatch(request({ path: '/api/v1/posts', method: 'POST', body: { title: 'Nope' } }));
  assert.equal(anonymous.status, 401);
});

test('mass-assignment fields in the body are ignored on create', () => {
  const { adapter, crypto, router } = setup();
  createUserRow(adapter, crypto, 'author9@a.com', 'author9', 'author');
  const token = signInToken(router, adapter, crypto, 'author9@a.com');

  const response = router.dispatch(
    request({
      path: '/api/v1/posts',
      method: 'POST',
      body: { title: 'Guarded', id: 999, author_id: 12345, status: 'published', created_at: 1, token },
    }),
  );

  assert.equal(response.status, 201);
  const data = (response.body as { data: { id: unknown; author_id: unknown; status: string } }).data;
  assert.notEqual(data.id, 999);
  assert.notEqual(data.author_id, 12345);
  assert.equal(data.status, 'draft');
});

test('status transition errors reach the envelope as 422 INVALID_TRANSITION', () => {
  const { adapter, crypto, router } = setup();
  const authorRow = createUserRow(adapter, crypto, 'author10@a.com', 'author10', 'author');
  const postDeps = { adapter, now: NOW };
  const post = createPost(postDeps, { id: authorRow.id, role: 'author', disabled: false }, { title: 'Transition' });
  const token = signInToken(router, adapter, crypto, 'author10@a.com');

  const response = router.dispatch(
    request({ path: `/api/v1/posts/${post.id}`, method: 'PATCH', body: { status: 'archived', token } }),
  );

  assert.equal(response.status, 422);
  assert.equal((response.body as { error: { code: string } }).error.code, 'INVALID_TRANSITION');
});

test('delete then show is 404', () => {
  const { adapter, crypto, router } = setup();
  const authorRow = createUserRow(adapter, crypto, 'author11@a.com', 'author11', 'author');
  const postDeps = { adapter, now: NOW };
  const post = createPost(postDeps, { id: authorRow.id, role: 'author', disabled: false }, { title: 'Deletable' });
  const token = signInToken(router, adapter, crypto, 'author11@a.com');
  router.dispatch(request({ path: `/api/v1/posts/${post.id}`, method: 'PATCH', body: { status: 'published', token } }));

  const deleteResponse = router.dispatch(request({ path: `/api/v1/posts/${post.id}`, method: 'DELETE', body: { token } }));
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual((deleteResponse.body as { data: unknown }).data, { id: String(post.id), deleted: true });

  const showResponse = router.dispatch(request({ path: `/api/v1/posts/${post.id}` }));
  assert.equal(showResponse.status, 404);
});

test('tags list is public; tag create is admin 201, author 403, duplicate 409', () => {
  const { adapter, crypto, router } = setup();
  createTag(adapter, 'Seeded', NOW);
  createUserRow(adapter, crypto, 'authorT@a.com', 'authorT', 'author');
  createUserRow(adapter, crypto, 'adminT@a.com', 'adminT', 'admin');
  const authorToken = signInToken(router, adapter, crypto, 'authorT@a.com');
  const adminToken = signInToken(router, adapter, crypto, 'adminT@a.com');

  const list = router.dispatch(request({ path: '/api/v1/tags' }));
  assert.equal(list.status, 200);
  assert.equal((list.body as { data: unknown[] }).data.length, 1);

  const asAuthor = router.dispatch(
    request({ path: '/api/v1/tags', method: 'POST', body: { name: 'New Tag', token: authorToken } }),
  );
  assert.equal(asAuthor.status, 403);

  const asAdmin = router.dispatch(
    request({ path: '/api/v1/tags', method: 'POST', body: { name: 'New Tag', token: adminToken } }),
  );
  assert.equal(asAdmin.status, 201);
  assert.equal((asAdmin.body as { data: { slug: string } }).data.slug, 'new-tag');

  const duplicate = router.dispatch(
    request({ path: '/api/v1/tags', method: 'POST', body: { name: 'New Tag', token: adminToken } }),
  );
  assert.equal(duplicate.status, 409);
});

test('protected list via POST + _method GET + token + body filters works', () => {
  const { adapter, crypto, router } = setup();
  const authorRow = createUserRow(adapter, crypto, 'author12@a.com', 'author12', 'author');
  const postDeps = { adapter, now: NOW };
  createPost(postDeps, { id: authorRow.id, role: 'author', disabled: false }, { title: 'Own Draft' });
  const token = signInToken(router, adapter, crypto, 'author12@a.com');

  const response = router.dispatch(
    request({ path: '/api/v1/posts', method: 'POST', body: { _method: 'GET', token, status: 'draft' } }),
  );

  assert.equal(response.status, 200);
  const body = response.body as { data: Array<{ title: string }> };
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].title, 'Own Draft');
});

test('?token= in params only is treated as anonymous (S9)', () => {
  const { adapter, crypto, router } = setup();
  const authorRow = createUserRow(adapter, crypto, 'author13@a.com', 'author13', 'author');
  const postDeps = { adapter, now: NOW };
  createPost(postDeps, { id: authorRow.id, role: 'author', disabled: false }, { title: 'Hidden Draft' });
  const token = signInToken(router, adapter, crypto, 'author13@a.com');

  const response = router.dispatch(request({ path: '/api/v1/posts', params: { token } }));

  assert.equal(response.status, 200);
  const body = response.body as { data: unknown[] };
  assert.equal(body.data.length, 0);
});

test('every response from the posts and tags routes is a valid envelope', () => {
  const { adapter, crypto, router } = setup();
  createUserRow(adapter, crypto, 'author14@a.com', 'author14', 'author');
  const token = signInToken(router, adapter, crypto, 'author14@a.com');

  const responses = [
    router.dispatch(request({ path: '/api/v1/posts' })),
    router.dispatch(request({ path: '/api/v1/tags' })),
    router.dispatch(request({ path: '/api/v1/posts', method: 'POST', body: { title: 'Env', token } })),
  ];

  for (const response of responses) {
    const body = response.body as { ok: boolean };
    assert.equal(typeof body.ok, 'boolean');
  }
});
