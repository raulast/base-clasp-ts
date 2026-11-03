import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canCreate, canView, canEdit, canDelete } from './post.policy.ts';
import type { PostUser, PostRecord } from './post.policy.ts';

const STATUSES = ['draft', 'published', 'archived'] as const;
const VISIBILITIES = ['public', 'members', 'private'] as const;

function user(overrides: Partial<PostUser> = {}): PostUser {
  return { id: 1, role: 'author', disabled: false, ...overrides };
}

function post(overrides: Partial<PostRecord> = {}): PostRecord {
  return { id: 10, author_id: 1, status: 'draft', visibility: 'public', deleted_at: null, ...overrides };
}

test('canCreate allows an enabled author or admin', () => {
  assert.equal(canCreate(user({ role: 'author' })), true);
  assert.equal(canCreate(user({ role: 'admin' })), true);
});

test('canCreate rejects a reader, a disabled user, and an anonymous caller', () => {
  assert.equal(canCreate(user({ role: 'reader' })), false);
  assert.equal(canCreate(user({ role: 'author', disabled: true })), false);
  assert.equal(canCreate(null), false);
});

test('canView never allows a deleted post regardless of role', () => {
  const deleted = post({ deleted_at: 1700000000000, status: 'published', visibility: 'public' });

  assert.equal(canView(null, deleted), false);
  assert.equal(canView(user({ role: 'admin' }), deleted), false);
  assert.equal(canView(user({ id: 1, role: 'author' }), deleted), false);
});

// Oracle built independently from the stated S3 rule, not from the implementation:
// admin -> always (unless deleted); owner -> always (unless deleted);
// otherwise -> only when status === 'published' and (visibility === 'public', or
// visibility === 'members' and a user is present).
function expectedCanView(callerRole: 'anonymous' | 'admin' | 'owner' | 'other', status: string, visibility: string): boolean {
  if (callerRole === 'admin' || callerRole === 'owner') return true;
  if (status !== 'published') return false;
  if (visibility === 'public') return true;
  if (visibility === 'members') return callerRole !== 'anonymous';
  return false;
}

test('canView matches the oracle across every status x visibility x caller combination', () => {
  const callers: Array<{ label: 'anonymous' | 'admin' | 'owner' | 'other'; value: PostUser | null }> = [
    { label: 'anonymous', value: null },
    { label: 'admin', value: user({ id: 99, role: 'admin' }) },
    { label: 'owner', value: user({ id: 1, role: 'author' }) },
    { label: 'other', value: user({ id: 2, role: 'reader' }) },
  ];

  for (const status of STATUSES) {
    for (const visibility of VISIBILITIES) {
      for (const caller of callers) {
        const record = post({ status, visibility });
        const expected = expectedCanView(caller.label, status, visibility);
        assert.equal(
          canView(caller.value, record),
          expected,
          `caller=${caller.label} status=${status} visibility=${visibility}`,
        );
      }
    }
  }
});

test('canView lets an owner demoted to reader still see their own unpublished post', () => {
  const demotedOwner = user({ id: 1, role: 'reader' });
  const draft = post({ author_id: 1, status: 'draft' });

  assert.equal(canView(demotedOwner, draft), true);
});

test('canView lets a disabled owner still see their own post (disabled only blocks login, not viewing their own data)', () => {
  const disabledOwner = user({ id: 1, role: 'author', disabled: true });
  const draft = post({ author_id: 1, status: 'draft' });

  assert.equal(canView(disabledOwner, draft), true);
});

test('canEdit allows an admin on any non-deleted post', () => {
  const draft = post({ author_id: 42 });

  assert.equal(canEdit(user({ id: 1, role: 'admin' }), draft), true);
});

test('canEdit allows the owner while their role is still author or admin', () => {
  const draft = post({ author_id: 1 });

  assert.equal(canEdit(user({ id: 1, role: 'author' }), draft), true);
  assert.equal(canEdit(user({ id: 1, role: 'admin' }), draft), true);
});

test('canEdit rejects the owner once demoted to reader', () => {
  const draft = post({ author_id: 1 });

  assert.equal(canEdit(user({ id: 1, role: 'reader' }), draft), false);
});

test('canEdit rejects a non-owner author, an anonymous caller, and a deleted post', () => {
  const draft = post({ author_id: 1 });
  const deleted = post({ author_id: 1, deleted_at: 1700000000000 });

  assert.equal(canEdit(user({ id: 2, role: 'author' }), draft), false);
  assert.equal(canEdit(null, draft), false);
  assert.equal(canEdit(user({ id: 1, role: 'author' }), deleted), false);
});

test('canDelete follows the same rule as canEdit', () => {
  const draft = post({ author_id: 1 });

  assert.equal(canDelete(user({ id: 1, role: 'author' }), draft), true);
  assert.equal(canDelete(user({ id: 99, role: 'admin' }), draft), true);
  assert.equal(canDelete(user({ id: 1, role: 'reader' }), draft), false);
  assert.equal(canDelete(user({ id: 2, role: 'author' }), draft), false);
});
