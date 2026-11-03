import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canComment, canDeleteComment } from './comment.policy.ts';
import type { PostUser, PostRecord } from './post.policy.ts';
import type { CommentRecord } from './comment.policy.ts';

const admin: PostUser = { id: 1, role: 'admin', disabled: false };
const author: PostUser = { id: 2, role: 'author', disabled: false };
const otherAuthor: PostUser = { id: 3, role: 'author', disabled: false };
const reader: PostUser = { id: 4, role: 'reader', disabled: false };
const disabledReader: PostUser = { id: 5, role: 'reader', disabled: true };

function post(overrides: Partial<PostRecord> = {}): PostRecord {
  return { id: 10, author_id: author.id, status: 'published', visibility: 'public', deleted_at: null, ...overrides };
}

test('canComment requires a logged-in, non-disabled user who can view a published post', () => {
  assert.equal(canComment(null, post()), false);
  assert.equal(canComment(disabledReader, post()), false);
  assert.equal(canComment(reader, post()), true);
  assert.equal(canComment(reader, post({ status: 'draft' })), false);
  assert.equal(canComment(reader, post({ visibility: 'private' })), false);
  assert.equal(canComment(author, post({ visibility: 'private' })), true); // owner always views own post
  assert.equal(canComment(admin, post({ status: 'draft' })), false); // even admin needs the post published
});

test('canComment is false once the post is not published, even for the owner', () => {
  assert.equal(canComment(author, post({ status: 'draft' })), false);
  assert.equal(canComment(author, post({ status: 'archived' })), false);
});

function comment(overrides: Partial<CommentRecord> = {}): CommentRecord {
  return { id: 100, post_id: 10, author_id: reader.id, deleted_at: null, ...overrides };
}

test('canDeleteComment allows the comment author, the post author, or an admin', () => {
  const thePost = post();
  assert.equal(canDeleteComment(reader, comment(), thePost), true); // comment author
  assert.equal(canDeleteComment(author, comment(), thePost), true); // post author
  assert.equal(canDeleteComment(admin, comment(), thePost), true); // admin
  assert.equal(canDeleteComment(otherAuthor, comment(), thePost), false);
  assert.equal(canDeleteComment(null, comment(), thePost), false);
});
