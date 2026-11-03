import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../../core/testing/in-memory-sheet-adapter.ts';
import { HttpError } from '../../core/api.ts';
import type { Row, SheetAdapter } from '../../core/sheet-adapter.ts';
import { createPost, type PostDeps } from './post.model.ts';
import { listComments, createComment, deleteComment } from './comment.model.ts';

const NOW = () => new Date(1700000000000);

function setup(): PostDeps {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'username', 'role', 'disabled']);
  adapter.seed('tags', ['id', 'name', 'slug', 'created_at', 'updated_at', 'deleted_at']);
  adapter.seed('posts', [
    'id',
    'author_id',
    'title',
    'slug',
    'excerpt',
    'body',
    'status',
    'visibility',
    'published_at',
    'created_at',
    'updated_at',
    'deleted_at',
  ]);
  adapter.seed('post_tags', ['id', 'post_id', 'tag_id']);
  adapter.seed('comments', ['id', 'post_id', 'author_id', 'body', 'created_at', 'updated_at', 'deleted_at']);
  return { adapter, now: NOW };
}

function addUser(adapter: SheetAdapter, overrides: Partial<Row> = {}): Row {
  const id = adapter.getRows('users').length + 1;
  const row = { id, username: 'u', role: 'reader', disabled: false, ...overrides };
  adapter.appendRow('users', row);
  return row;
}

function asUser(row: Row): { id: unknown; role: string; disabled: boolean } {
  return { id: row.id, role: String(row.role), disabled: row.disabled === true };
}

function publish(deps: PostDeps, postId: unknown): void {
  const index = deps.adapter.findRowIndex('posts', (row) => String(row.id) === String(postId));
  const existing = deps.adapter.getRows('posts')[index];
  deps.adapter.updateRow('posts', index, { ...existing, status: 'published', published_at: NOW().getTime() });
}

function throwsHttp(fn: () => void, status: number, code?: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, status);
    if (code) assert.equal(error.code, code);
    return true;
  });
}

test('listComments 404s when the post is not viewable', () => {
  const deps = setup();
  const authorRow = addUser(deps.adapter, { role: 'author' });
  const post = createPost(deps, asUser(authorRow), { title: 'Draft' });

  throwsHttp(() => listComments(deps, null, String(post.id), {}), 404);
});

test('listComments returns non-deleted comments oldest first, paginated, with author attached', () => {
  const deps = setup();
  const authorRow = addUser(deps.adapter, { role: 'author' });
  const post = createPost(deps, asUser(authorRow), { title: 'Open Post' });
  publish(deps, post.id);
  const reader1 = addUser(deps.adapter, { username: 'reader1' });
  const reader2 = addUser(deps.adapter, { username: 'reader2' });
  const first = createComment(deps, asUser(reader1), String(post.id), { body: 'First' });
  const second = createComment(deps, asUser(reader2), String(post.id), { body: 'Second' });
  deleteComment(deps, asUser(reader2), second.id);

  const result = listComments(deps, null, String(post.id), {});
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].id, first.id);
  assert.equal(result.data[0].author.username, 'reader1');
  assert.equal(result.meta.total, 1);
});

test('listComments reads users once regardless of comment count (no N+1)', () => {
  const deps = setup();
  const authorRow = addUser(deps.adapter, { role: 'author' });
  const post = createPost(deps, asUser(authorRow), { title: 'Open Post' });
  publish(deps, post.id);
  const reader1 = addUser(deps.adapter, { username: 'reader1' });
  createComment(deps, asUser(reader1), String(post.id), { body: 'One' });
  createComment(deps, asUser(reader1), String(post.id), { body: 'Two' });
  createComment(deps, asUser(reader1), String(post.id), { body: 'Three' });

  function usersReadsFor(adapter: SheetAdapter): number {
    let reads = 0;
    const proxy = new Proxy(adapter, {
      get(target, prop, receiver) {
        if (prop === 'getRows') {
          return (sheetName: string) => {
            if (sheetName === 'users') reads += 1;
            return target.getRows(sheetName);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as SheetAdapter;
    listComments({ adapter: proxy, now: NOW }, null, String(post.id), {});
    return reads;
  }

  const readsWithThreeComments = usersReadsFor(deps.adapter);
  createComment(deps, asUser(reader1), String(post.id), { body: 'Four' });
  createComment(deps, asUser(reader1), String(post.id), { body: 'Five' });
  const readsWithFiveComments = usersReadsFor(deps.adapter);

  assert.equal(readsWithFiveComments, readsWithThreeComments);
});

test('createComment 404s when the post is not viewable, 403 when viewable but not published', () => {
  const deps = setup();
  const authorRow = addUser(deps.adapter, { role: 'author' });
  const post = createPost(deps, asUser(authorRow), { title: 'Draft' });
  const reader = addUser(deps.adapter);

  throwsHttp(() => createComment(deps, asUser(reader), String(post.id), { body: 'hi' }), 404);

  throwsHttp(() => createComment(deps, asUser(authorRow), String(post.id), { body: 'hi' }), 403);
});

test('createComment validates body length', () => {
  const deps = setup();
  const authorRow = addUser(deps.adapter, { role: 'author' });
  const post = createPost(deps, asUser(authorRow), { title: 'Open Post' });
  publish(deps, post.id);
  const reader = addUser(deps.adapter);

  throwsHttp(() => createComment(deps, asUser(reader), String(post.id), { body: '' }), 422);
  throwsHttp(() => createComment(deps, asUser(reader), String(post.id), { body: 'x'.repeat(2001) }), 422);

  const created = createComment(deps, asUser(reader), String(post.id), { body: '  hello world  ' });
  assert.equal(created.body, 'hello world');
  assert.equal(created.author.id, reader.id);
});

test('deleteComment allows the comment author, the post author, or an admin, and 403s others', () => {
  const deps = setup();
  const authorRow = addUser(deps.adapter, { role: 'author' });
  const post = createPost(deps, asUser(authorRow), { title: 'Open Post' });
  publish(deps, post.id);
  const reader = addUser(deps.adapter);
  const otherReader = addUser(deps.adapter, { username: 'other-reader' });
  const admin = addUser(deps.adapter, { role: 'admin' });

  const c1 = createComment(deps, asUser(reader), String(post.id), { body: 'mine' });
  throwsHttp(() => deleteComment(deps, asUser(otherReader), c1.id), 403);
  const result = deleteComment(deps, asUser(reader), c1.id);
  assert.deepEqual(result, { id: c1.id, deleted: true });

  const c2 = createComment(deps, asUser(reader), String(post.id), { body: 'by post author' });
  const asPostAuthor = deleteComment(deps, asUser(authorRow), c2.id);
  assert.deepEqual(asPostAuthor, { id: c2.id, deleted: true });

  const c3 = createComment(deps, asUser(reader), String(post.id), { body: 'by admin' });
  const asAdmin = deleteComment(deps, asUser(admin), c3.id);
  assert.deepEqual(asAdmin, { id: c3.id, deleted: true });
});

test('deleteComment 404s on a missing comment or when the post is no longer viewable', () => {
  const deps = setup();
  const authorRow = addUser(deps.adapter, { role: 'author' });
  const post = createPost(deps, asUser(authorRow), { title: 'Open Post' });
  publish(deps, post.id);
  const reader = addUser(deps.adapter);

  throwsHttp(() => deleteComment(deps, asUser(reader), 999), 404);

  const comment = createComment(deps, asUser(reader), String(post.id), { body: 'about to be hidden' });
  const index = deps.adapter.findRowIndex('posts', (row) => String(row.id) === String(post.id));
  const existing = deps.adapter.getRows('posts')[index];
  deps.adapter.updateRow('posts', index, { ...existing, deleted_at: NOW().getTime() });

  throwsHttp(() => deleteComment(deps, asUser(reader), comment.id), 404);
});

test('deleted post hides its comments (404)', () => {
  const deps = setup();
  const authorRow = addUser(deps.adapter, { role: 'author' });
  const post = createPost(deps, asUser(authorRow), { title: 'Open Post' });
  publish(deps, post.id);
  const reader = addUser(deps.adapter);
  createComment(deps, asUser(reader), String(post.id), { body: 'visible for now' });

  const index = deps.adapter.findRowIndex('posts', (row) => String(row.id) === String(post.id));
  const existing = deps.adapter.getRows('posts')[index];
  deps.adapter.updateRow('posts', index, { ...existing, deleted_at: NOW().getTime() });

  throwsHttp(() => listComments(deps, asUser(authorRow), String(post.id), {}), 404);
});
