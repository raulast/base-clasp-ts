import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../../core/testing/in-memory-sheet-adapter.ts';
import { HttpError } from '../../core/api.ts';
import type { Row } from '../../core/sheet-adapter.ts';
import { createTag } from './tag.model.ts';
import {
  createPost,
  updatePost,
  deletePost,
  findPostForUser,
  listPostsForUser,
  toPostRecord,
  type PostDeps,
  type PostRecord,
} from './post.model.ts';

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
  return { adapter, now: NOW };
}

function addUser(deps: PostDeps, overrides: Partial<Row> = {}): Row {
  const id = deps.adapter.getRows('users').length + 1;
  const row = { id, username: 'u', role: 'author', disabled: false, ...overrides };
  deps.adapter.appendRow('users', row);
  return row;
}

function author(deps: PostDeps, overrides: Partial<Row> = {}): Row {
  return addUser(deps, { email: `author${Math.random()}@a.com`, role: 'author', ...overrides });
}

function admin(deps: PostDeps): Row {
  return addUser(deps, { email: 'admin@a.com', role: 'admin' });
}

function reader(deps: PostDeps): Row {
  return addUser(deps, { email: `reader${Math.random()}@a.com`, role: 'reader' });
}

function asUser(row: Row): { id: unknown; role: string; disabled: boolean } {
  return { id: row.id, role: String(row.role), disabled: row.disabled === true };
}

test('createPost rejects a reader with 403', () => {
  const deps = setup();
  const user = reader(deps);

  assert.throws(() => createPost(deps, asUser(user), { title: 'Hello' }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 403);
    return true;
  });
});

test('createPost validates title, excerpt and body length', () => {
  const deps = setup();
  const user = author(deps);

  assert.throws(() => createPost(deps, asUser(user), { title: '' }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 422);
    assert.ok('title' in (error.details ?? {}));
    return true;
  });

  assert.throws(() => createPost(deps, asUser(user), { title: 'a'.repeat(201) }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.ok('title' in (error.details ?? {}));
    return true;
  });

  assert.throws(() => createPost(deps, asUser(user), { title: 'Ok', excerpt: 'x'.repeat(301) }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.ok('excerpt' in (error.details ?? {}));
    return true;
  });

  assert.throws(() => createPost(deps, asUser(user), { title: 'Ok', body: 'x'.repeat(50001) }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.ok('body' in (error.details ?? {}));
    return true;
  });
});

test('createPost always starts as draft, ignoring a status in the input, and defaults visibility to public', () => {
  const deps = setup();
  const user = author(deps);

  const post = createPost(deps, asUser(user), { title: 'Hello world', status: 'published' });

  assert.equal(post.status, 'draft');
  assert.equal(post.visibility, 'public');
});

test('createPost generates a unique slug from the title with -2, -3 suffixes on collision', () => {
  const deps = setup();
  const user = author(deps);

  const first = createPost(deps, asUser(user), { title: 'My Post' });
  const second = createPost(deps, asUser(user), { title: 'My Post' });
  const third = createPost(deps, asUser(user), { title: 'My Post' });

  assert.equal(first.slug, 'my-post');
  assert.equal(second.slug, 'my-post-2');
  assert.equal(third.slug, 'my-post-3');
});

test('createPost rejects an explicit duplicate slug with 409', () => {
  const deps = setup();
  const user = author(deps);
  createPost(deps, asUser(user), { title: 'First', slug: 'taken' });

  assert.throws(() => createPost(deps, asUser(user), { title: 'Second', slug: 'taken' }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 409);
    return true;
  });
});

test('a deleted post keeps its slug reserved, so a later post with the same title gets a suffix (links stay stable)', () => {
  const deps = setup();
  const user = asUser(author(deps));
  const post = createPost(deps, user, { title: 'Stable Link' });
  deletePost(deps, user, post.id);

  const again = createPost(deps, user, { title: 'Stable Link' });

  assert.equal(again.slug, 'stable-link-2');
});

test('createPost rejects unknown tag slugs with 422 listing them in details.tags', () => {
  const deps = setup();
  const user = author(deps);
  createTag(deps.adapter, 'Tutorial', deps.now);

  assert.throws(
    () => createPost(deps, asUser(user), { title: 'Hello', tags: ['tutorial', 'ghost-tag'] }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 422);
      assert.deepEqual((error.details as Record<string, unknown>).tags, ['ghost-tag']);
      return true;
    },
  );
});

test('createPost attaches tags by slug and updatePost syncs them', () => {
  const deps = setup();
  const user = asUser(author(deps));
  createTag(deps.adapter, 'Tutorial', deps.now);
  createTag(deps.adapter, 'Apps Script', deps.now);

  const post = createPost(deps, user, { title: 'Hello', tags: ['tutorial'] });
  assert.deepEqual(post.tags.map((tag) => tag.slug), ['tutorial']);

  const updated = updatePost(deps, user, post.id, { tags: ['apps-script'] });
  assert.deepEqual(updated?.tags.map((tag) => tag.slug), ['apps-script']);
});

test('updatePost enforces the S3 status transitions and rejects everything else with 422 INVALID_TRANSITION', () => {
  const deps = setup();
  const user = asUser(author(deps));
  const post = createPost(deps, user, { title: 'Hello' });

  assert.throws(() => updatePost(deps, user, post.id, { status: 'archived' }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 422);
    assert.equal(error.code, 'INVALID_TRANSITION');
    return true;
  });

  const published = updatePost(deps, user, post.id, { status: 'published' });
  assert.equal(published?.status, 'published');
  assert.ok(published?.published_at);

  const archived = updatePost(deps, user, post.id, { status: 'archived' });
  assert.equal(archived?.status, 'archived');

  const backToDraft = updatePost(deps, user, post.id, { status: 'draft' });
  assert.equal(backToDraft?.status, 'draft');

  assert.throws(() => updatePost(deps, user, post.id, { status: 'archived' }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, 'INVALID_TRANSITION');
    return true;
  });
});

test('published_at is set once on the first transition to published and never overwritten', () => {
  const deps = setup();
  const user = asUser(author(deps));
  const post = createPost(deps, user, { title: 'Hello' });

  const published = updatePost(deps, user, post.id, { status: 'published' });
  const firstPublishedAt = published?.published_at;

  const archived = updatePost(deps, user, post.id, { status: 'archived' });
  const draft = updatePost(deps, user, archived!.id, { status: 'draft' });
  const republished = updatePost(deps, user, draft!.id, { status: 'published' });

  assert.equal(republished?.published_at, firstPublishedAt);
});

test('updatePost keeps the slug on a title change unless an explicit slug is given', () => {
  const deps = setup();
  const user = asUser(author(deps));
  const post = createPost(deps, user, { title: 'Original Title' });

  const renamed = updatePost(deps, user, post.id, { title: 'New Title' });
  assert.equal(renamed?.slug, 'original-title');

  const resluged = updatePost(deps, user, post.id, { slug: 'brand-new-slug' });
  assert.equal(resluged?.slug, 'brand-new-slug');
});

test('updatePost returns 404 for a missing post and 403 for a viewable post the caller cannot edit', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const otherAuthor = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'Hello', status: 'draft' });

  assert.throws(() => updatePost(deps, owner, 999999, { title: 'x' }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 404);
    return true;
  });

  assert.throws(() => updatePost(deps, otherAuthor, post.id, { title: 'x' }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 404);
    return true;
  });

  updatePost(deps, owner, post.id, { status: 'published', visibility: 'public' });

  assert.throws(() => updatePost(deps, otherAuthor, post.id, { title: 'x' }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 403);
    return true;
  });
});

test('deletePost soft-deletes and 404/403 follow the same rules as update', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const other = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'Hello' });

  assert.throws(() => deletePost(deps, other, post.id), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 404);
    return true;
  });

  deletePost(deps, owner, post.id);

  assert.throws(() => deletePost(deps, owner, post.id), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 404);
    return true;
  });
});

test('findPostForUser finds by numeric id or by slug and returns 404 when not viewable (no existence leak)', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const stranger = asUser(reader(deps));
  const post = createPost(deps, owner, { title: 'Findable' });

  assert.equal(findPostForUser(deps, owner, String(post.id))?.id, post.id);
  assert.equal(findPostForUser(deps, owner, 'findable')?.id, post.id);

  assert.throws(() => findPostForUser(deps, stranger, String(post.id)), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 404);
    return true;
  });
  assert.throws(() => findPostForUser(deps, stranger, 'findable'), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 404);
    return true;
  });
  assert.throws(() => findPostForUser(deps, null, 'no-such-slug'), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 404);
    return true;
  });
});

test('listPostsForUser only returns viewable posts, never leaking another author draft or private post', () => {
  const deps = setup();
  const authorA = asUser(author(deps));
  const authorB = asUser(author(deps));
  const stranger = asUser(reader(deps));

  createPost(deps, authorA, { title: 'A Draft' });
  const published = createPost(deps, authorA, { title: 'A Published' });
  updatePost(deps, authorA, published.id, { status: 'published' });
  createPost(deps, authorB, { title: 'B Private', visibility: 'members' });

  const list = listPostsForUser(deps, stranger, {});

  assert.deepEqual(list.data.map((row) => row.title), ['A Published']);
});

test('listPostsForUser paginates, filters by tag/author/status, and sorts by published_at then created_at desc', () => {
  const deps = setup();
  const user = asUser(admin(deps));
  createTag(deps.adapter, 'Tutorial', deps.now);

  const first = createPost(deps, user, { title: 'First', tags: ['tutorial'] });
  const second = createPost(deps, user, { title: 'Second' });
  updatePost(deps, user, first.id, { status: 'published' });
  deps.now = () => new Date(1700000001000);
  updatePost(deps, user, second.id, { status: 'published' });

  const byTag = listPostsForUser(deps, user, { tag: 'tutorial' });
  assert.deepEqual(byTag.data.map((row) => row.title), ['First']);

  const byAuthor = listPostsForUser(deps, user, { author: user.id });
  assert.equal(byAuthor.data.length, 2);

  const byStatus = listPostsForUser(deps, user, { status: 'draft' });
  assert.equal(byStatus.data.length, 0);

  const paged = listPostsForUser(deps, user, { page: 1, perPage: 1 });
  assert.equal(paged.data.length, 1);
  assert.equal(paged.meta.total, 2);
  assert.equal(paged.meta.pages, 2);
  assert.equal(paged.data[0].title, 'Second');
});

test('listPostsForUser rejects an invalid page/perPage with 422', () => {
  const deps = setup();
  const user = asUser(admin(deps));

  assert.throws(() => listPostsForUser(deps, user, { perPage: 999 }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 422);
    return true;
  });
});

test('every returned post includes tags and a sanitized author (never email or password)', () => {
  const deps = setup();
  const user = asUser(author(deps));
  createTag(deps.adapter, 'Tutorial', deps.now);

  const post = createPost(deps, user, { title: 'Hello', tags: ['tutorial'] });

  assert.deepEqual(Object.keys(post.author).sort(), ['id', 'username']);
  assert.deepEqual(post.tags[0]?.slug, 'tutorial');
});

class CountingSheetAdapter extends InMemorySheetAdapter {
  reads: Record<string, number> = {};

  getRows(sheetName: string) {
    this.reads[sheetName] = (this.reads[sheetName] ?? 0) + 1;
    return super.getRows(sheetName);
  }
}

test('listPostsForUser reads each sheet once, whatever the page size (no N+1)', () => {
  const base = setup();
  const adapter = new CountingSheetAdapter();
  for (const sheet of ['users', 'tags', 'posts', 'post_tags']) {
    adapter.seed(sheet, base.adapter.getHeaders(sheet));
  }
  const deps: PostDeps = { adapter, now: NOW };
  const writer = asUser(author(deps));
  createTag(deps.adapter, 'General', NOW);
  for (let index = 0; index < 12; index++) {
    const post = createPost(deps, writer, { title: `Post ${index}`, tags: ['general'] });
    updatePost(deps, writer, post.id, { status: 'published' });
  }
  adapter.reads = {};

  const result = listPostsForUser(deps, null, { perPage: 10 });

  assert.equal(result.data.length, 10);
  assert.ok(result.data.every((post) => post.tags.length === 1 && post.author.username === 'u'));
  for (const sheet of ['users', 'tags', 'posts', 'post_tags']) {
    assert.ok((adapter.reads[sheet] ?? 0) <= 1, `${sheet} read ${adapter.reads[sheet]} times`);
  }
});

test('onPostChanged fires with the updated post after updatePost commits', () => {
  const deps = setup();
  const seen: PostRecord[] = [];
  const withHook: PostDeps = { ...deps, onPostChanged: (post) => seen.push(post) };
  const owner = asUser(author(withHook));
  const post = createPost(withHook, owner, { title: 'Hook me' });
  assert.equal(seen.length, 0, 'createPost does not fire the hook');

  updatePost(withHook, owner, post.id, { status: 'published' });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, post.id);
  assert.equal(seen[0].status, 'published');
});

test('onPostChanged fires with a deleted post record after deletePost commits', () => {
  const deps = setup();
  const seen: PostRecord[] = [];
  const withHook: PostDeps = { ...deps, onPostChanged: (post) => seen.push(post) };
  const owner = asUser(author(withHook));
  const post = createPost(withHook, owner, { title: 'Delete me' });

  deletePost(withHook, owner, post.id);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, post.id);
  assert.notEqual(seen[0].deleted_at, null);
  assert.notEqual(seen[0].deleted_at, '');
});

test('onPostChanged is never called when the deps do not provide it', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'No hook' });
  assert.doesNotThrow(() => updatePost(deps, owner, post.id, { status: 'published' }));
  assert.doesNotThrow(() => deletePost(deps, owner, post.id));
});

test('toPostRecord maps a sheet row to the policy-facing PostRecord shape', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'Record shape' });
  const row = deps.adapter.getRows('posts').find((candidate) => candidate.id === post.id)!;

  const record = toPostRecord(row);

  assert.equal(record.id, post.id);
  assert.equal(record.status, 'draft');
  assert.equal(record.visibility, 'public');
});

test('an empty update still fires onPostChanged, so the UI can retry a failed media sync', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'Hello' });
  const seen: unknown[] = [];
  const withHook: PostDeps = { ...deps, onPostChanged: (changed) => seen.push(changed) };

  updatePost(withHook, owner, post.id, {});

  assert.equal(seen.length, 1);
});
