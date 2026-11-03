import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../../core/testing/in-memory-sheet-adapter.ts';
import { InMemoryStorageAdapter } from '../../core/testing/in-memory-storage-adapter.ts';
import { HttpError } from '../../core/api.ts';
import type { Row } from '../../core/sheet-adapter.ts';
import { createPost, updatePost, deletePost, toPostRecord, type PostDeps } from './post.model.ts';
import { uploadMedia, listMedia, getMedia, deleteMedia, syncPostMediaSharing, type MediaDeps } from './media.model.ts';

const NOW = () => new Date(1700000000000);
const FOLDER_ID = 'folder-1';

const PNG_BASE64 = Buffer.from('tiny-png-bytes').toString('base64');
const MP4_BASE64 = Buffer.from('tiny-mp4-bytes').toString('base64');

function setup(): MediaDeps {
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
  adapter.seed('media', [
    'id',
    'post_id',
    'owner_id',
    'drive_file_id',
    'name',
    'mime_type',
    'size',
    'kind',
    'is_public',
    'created_at',
    'updated_at',
    'deleted_at',
  ]);
  const storage = new InMemoryStorageAdapter();
  return { adapter, now: NOW, storage, getFolderId: () => FOLDER_ID };
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

function reader(deps: PostDeps): Row {
  return addUser(deps, { email: `reader${Math.random()}@a.com`, role: 'reader' });
}

function asUser(row: Row): { id: unknown; role: string; disabled: boolean } {
  return { id: row.id, role: String(row.role), disabled: row.disabled === true };
}

test('uploadMedia saves the file, creates a private row for a draft post, and does not call getFolderId before an upload', () => {
  const deps = setup();
  let folderIdCalls = 0;
  const trackedDeps: MediaDeps = { ...deps, getFolderId: () => { folderIdCalls += 1; return FOLDER_ID; } };
  const owner = asUser(author(trackedDeps));
  const post = createPost(trackedDeps, owner, { title: 'Draft post' });
  assert.equal(folderIdCalls, 0, 'getFolderId must only be called when an upload happens');

  const media = uploadMedia(trackedDeps, owner, String(post.id), { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64 });

  assert.equal(folderIdCalls, 1);
  assert.equal(media.name, 'a.png');
  assert.equal(media.kind, 'image');
  assert.equal(media.url, undefined, 'draft posts stay private');
  assert.equal((media as unknown as { drive_file_id?: unknown }).drive_file_id, undefined);
  assert.equal((media as unknown as { owner_id?: unknown }).owner_id, undefined);
});

test('uploadMedia rejects a non-owner author with 403 on a viewable post, and 404 on a non-viewable one', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const otherAuthor = asUser(author(deps));
  const draft = createPost(deps, owner, { title: 'Draft' });
  const published = createPost(deps, owner, { title: 'Published' });
  updatePost(deps, owner, published.id, { status: 'published' });

  assert.throws(
    () => uploadMedia(deps, otherAuthor, String(published.id), { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64 }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 403);
      return true;
    },
  );
  assert.throws(
    () => uploadMedia(deps, otherAuthor, String(draft.id), { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64 }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 404);
      return true;
    },
  );
  assert.throws(
    () => uploadMedia(deps, null, String(draft.id), { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64 }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 404);
      return true;
    },
  );
});

test('uploadMedia returns 413 for an oversized payload and 415 for an unsupported mime type', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'Owned' });

  assert.throws(
    () =>
      uploadMedia(deps, owner, String(post.id), {
        name: 'a.png',
        mimeType: 'image/png',
        data: 'A'.repeat(3 * 1024 * 1024),
      }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 413);
      return true;
    },
  );
  assert.throws(
    () => uploadMedia(deps, owner, String(post.id), { name: 'a.exe', mimeType: 'application/x-msdownload', data: PNG_BASE64 }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 415);
      return true;
    },
  );
});

test('uploadMedia returns 422 for an invalid payload', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'Owned' });

  assert.throws(
    () => uploadMedia(deps, owner, String(post.id), { name: '', mimeType: 'image/png', data: PNG_BASE64 }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 422);
      return true;
    },
  );
});

test('links are only present for a published+public post, and a draft upload stays private', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'Owned' });

  const draftMedia = uploadMedia(deps, owner, String(post.id), { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64 });
  assert.equal(draftMedia.url, undefined);

  updatePost(deps, owner, post.id, { status: 'published' });
  const published = uploadMedia(deps, owner, String(post.id), { name: 'b.png', mimeType: 'image/png', data: PNG_BASE64 });
  assert.ok(published.url);
  assert.ok(published.downloadUrl);
  assert.equal(published.embedUrl, undefined, 'embedUrl is only for video');
});

test('publishing an existing post makes its already-uploaded media public via syncPostMediaSharing', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'Owned' });
  const media = uploadMedia(deps, owner, String(post.id), { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64 });
  assert.equal(media.url, undefined);

  const withHook: PostDeps = { ...deps, onPostChanged: (changedPost) => syncPostMediaSharing(deps, changedPost) };
  updatePost(withHook, owner, post.id, { status: 'published' });

  const [refreshed] = listMedia(deps, owner, String(post.id));
  assert.ok(refreshed.url, 'media becomes public once the post is published+public');
});

test('switching a published post to members, or archiving it, unshares its media', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'Owned' });
  updatePost(deps, owner, post.id, { status: 'published' });
  const media = uploadMedia(deps, owner, String(post.id), { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64 });
  assert.ok(media.url);

  const withHook: PostDeps = { ...deps, onPostChanged: (changedPost) => syncPostMediaSharing(deps, changedPost) };
  updatePost(withHook, owner, post.id, { visibility: 'members' });
  const [afterMembers] = listMedia(deps, owner, String(post.id));
  assert.equal(afterMembers.url, undefined);

  updatePost(withHook, owner, post.id, { visibility: 'public' });
  updatePost(withHook, owner, post.id, { status: 'archived' });
  const [afterArchive] = listMedia(deps, owner, String(post.id));
  assert.equal(afterArchive.url, undefined);
});

test('deleting the post unshares its media via onPostChanged', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'Owned' });
  updatePost(deps, owner, post.id, { status: 'published' });
  uploadMedia(deps, owner, String(post.id), { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64 });

  const withHook: PostDeps = { ...deps, onPostChanged: (changedPost) => syncPostMediaSharing(deps, changedPost) };
  deletePost(withHook, owner, post.id);

  const rawMediaRow = deps.adapter.getRows('media').find((row) => sameIdLoose(row.post_id, post.id))!;
  assert.equal(rawMediaRow.is_public, false);
});

function sameIdLoose(a: unknown, b: unknown): boolean {
  return String(a) === String(b);
}

test('getMedia returns base64 to an authorized reader on a protected post and 404 to anonymous', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'Members only', visibility: 'members' });
  updatePost(deps, owner, post.id, { status: 'published' });
  const media = uploadMedia(deps, owner, String(post.id), { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64 });
  const memberReader = asUser(reader(deps));

  const asMember = getMedia(deps, memberReader, media.id, { download: true });
  assert.equal(asMember.data, PNG_BASE64);

  assert.throws(() => getMedia(deps, null, media.id, { download: true }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 404);
    return true;
  });
});

test('getMedia rejects a protected video download with 415', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'Members video', visibility: 'members' });
  updatePost(deps, owner, post.id, { status: 'published' });
  const media = uploadMedia(deps, owner, String(post.id), { name: 'a.mp4', mimeType: 'video/mp4', data: MP4_BASE64 });
  const memberReader = asUser(reader(deps));

  assert.throws(() => getMedia(deps, memberReader, media.id, { download: true }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 415);
    return true;
  });
});

test('deleteMedia trashes the Drive file and soft-deletes the row; owner only', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const other = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'Owned' });
  updatePost(deps, owner, post.id, { status: 'published' });
  const media = uploadMedia(deps, owner, String(post.id), { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64 });

  assert.throws(() => deleteMedia(deps, other, media.id), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 403);
    return true;
  });

  const result = deleteMedia(deps, owner, media.id);
  assert.deepEqual(result, { id: media.id, deleted: true });

  const file = [...deps.storage.files.values()][0];
  assert.equal(file.trashed, true);
  assert.throws(() => getMedia(deps, owner, media.id), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 404);
    return true;
  });
});

test('listMedia returns 404 when the post is not viewable, and no response contains drive_file_id or owner_id', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const stranger = asUser(reader(deps));
  const post = createPost(deps, owner, { title: 'Private', visibility: 'private' });
  uploadMedia(deps, owner, String(post.id), { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64 });

  assert.throws(() => listMedia(deps, stranger, String(post.id)), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 404);
    return true;
  });

  const [media] = listMedia(deps, owner, String(post.id));
  assert.equal((media as unknown as { drive_file_id?: unknown }).drive_file_id, undefined);
  assert.equal((media as unknown as { owner_id?: unknown }).owner_id, undefined);
});

test('toPostRecord is reused to drive isPostPublic through syncPostMediaSharing', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'Owned' });
  const row = deps.adapter.getRows('posts').find((candidate) => candidate.id === post.id)!;
  updatePost(deps, owner, post.id, { status: 'published' });
  const updatedRow = deps.adapter.getRows('posts').find((candidate) => candidate.id === post.id)!;

  uploadMedia(deps, owner, String(post.id), { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64 });
  syncPostMediaSharing(deps, toPostRecord(updatedRow));

  const [media] = listMedia(deps, owner, String(post.id));
  assert.ok(media.url);
  assert.notEqual(row.status, updatedRow.status);
});

test('getMedia on a public post returns links and never inlines base64, even with download requested', () => {
  const deps = setup();
  const owner = asUser(author(deps));
  const post = createPost(deps, owner, { title: 'Public' });
  updatePost(deps, owner, post.id, { status: 'published' });
  const media = uploadMedia(deps, owner, String(post.id), { name: 'a.png', mimeType: 'image/png', data: PNG_BASE64 });

  const view = getMedia(deps, null, media.id, { download: true });

  assert.ok(view.url);
  assert.equal(view.data, undefined);
});
