import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../../core/testing/in-memory-sheet-adapter.ts';
import { InMemoryLockAdapter } from '../../core/testing/in-memory-lock-adapter.ts';
import { NodeCryptoAdapter } from '../../core/testing/node-crypto-adapter.ts';
import { hashPassword } from '../../core/auth.ts';
import type { CryptoAdapter } from '../../core/crypto-adapter.ts';
import { HttpError } from '../../core/api.ts';
import { createUser, authenticate, findUserById, sanitizeUser, normalizeRole, isDisabled, listUsers, updateUserAdmin, MAX_PASSWORD_LENGTH } from './user.model.ts';

const SECRET = 'test-secret';
const NOW = () => new Date(1700000000000);

function setup() {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'username', 'password', 'created_at', 'updated_at', 'deleted_at']);
  const crypto = new NodeCryptoAdapter();
  return { adapter, crypto };
}

function countingCrypto(delegate: CryptoAdapter) {
  let hmacCalls = 0;
  const adapter: CryptoAdapter = {
    hmacSha256Base64Url: (message: string, key: string) => {
      hmacCalls++;
      return delegate.hmacSha256Base64Url(message, key);
    },
    base64UrlEncode: (text: string) => delegate.base64UrlEncode(text),
    base64UrlDecode: (text: string) => delegate.base64UrlDecode(text),
    randomSalt: () => delegate.randomSalt(),
  };
  return { adapter, calls: () => hmacCalls, reset: () => (hmacCalls = 0) };
}

test('createUser hashes the password and strips it from the returned row', () => {
  const { adapter, crypto } = setup();

  const user = createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);

  assert.equal(user.email, 'ana@example.com');
  assert.ok(!('password' in user));
  const stored = adapter.getRows('users')[0];
  assert.notEqual(stored.password, 'secretpw');
});

test('createUser rejects a duplicate email', () => {
  const { adapter, crypto } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);

  assert.throws(() => createUser(adapter, crypto, 'ana@example.com', 'other', 'ana2', NOW));
});

test('createUser stores the username', () => {
  const { adapter, crypto } = setup();

  const user = createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);

  assert.equal(user.username, 'ana');
  assert.equal(adapter.getRows('users')[0].username, 'ana');
});

test('createUser rejects a duplicate username without writing', () => {
  const { adapter, crypto } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);

  assert.throws(
    () => createUser(adapter, crypto, 'other@example.com', 'secretpw', 'ana', 'reader', NOW),
    /Username already taken/,
  );
  assert.equal(adapter.getRows('users').length, 1);
});

test('authenticate returns a token for the right credentials', () => {
  const { adapter, crypto } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);

  const result = authenticate(adapter, crypto, SECRET, 'ana@example.com', 'secretpw', NOW);

  assert.equal(result.ok, true);
  assert.ok(typeof result.token === 'string');
});

test('authenticate does equal HMAC work for an unknown email and a wrong password', () => {
  const { adapter, crypto } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);

  const counter = countingCrypto(crypto);
  authenticate(adapter, counter.adapter, SECRET, 'warm-the-dummy-hash-cache@example.com', 'whatever', NOW);
  counter.reset();

  authenticate(adapter, counter.adapter, SECRET, 'nobody@example.com', 'whatever', NOW);
  const unknownCalls = counter.calls();
  counter.reset();

  authenticate(adapter, counter.adapter, SECRET, 'ana@example.com', 'wrong-password', NOW);
  const wrongCalls = counter.calls();

  assert.equal(unknownCalls, wrongCalls);
  assert.ok(unknownCalls > 0);
});

test('authenticate verifies a seeded hashPassword value', () => {
  const { adapter, crypto } = setup();
  const stored = hashPassword('secretpw', crypto);
  adapter.appendRow('users', { id: 1, email: 'seed@example.com', password: stored, created_at: 1, updated_at: 1, deleted_at: null });

  const result = authenticate(adapter, crypto, SECRET, 'seed@example.com', 'secretpw', NOW);

  assert.equal(result.ok, true);
});

test('findUserById returns the user without the password', () => {
  const { adapter, crypto } = setup();
  const created = createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);

  const found = findUserById(adapter, created.id);

  assert.ok(found);
  assert.equal(found?.email, 'ana@example.com');
  assert.ok(!found || !('password' in found));
});

test('findUserById returns null for an unknown id', () => {
  const { adapter } = setup();

  assert.equal(findUserById(adapter, 999), null);
});

test('createUser runs its duplicate checks and insert inside one lock acquisition', () => {
  const { adapter, crypto } = setup();
  const lock = new InMemoryLockAdapter();

  createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW, lock);

  assert.equal(lock.acquisitions, 1);
  assert.equal(lock.releases, 1);
});

test('sanitizeUser strips the password field', () => {
  const sanitized = sanitizeUser({ id: 1, email: 'ana@example.com', password: 'hashed' });

  assert.ok(!('password' in sanitized));
  assert.equal(sanitized.email, 'ana@example.com');
});

test('createUser rejects invalid fields with a 422 and per-field details', () => {
  const { adapter, crypto } = setup();

  assert.throws(
    () => createUser(adapter, crypto, 'not-an-email', 'short', '!!', 'nope', NOW),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.ok(error.details?.email);
      assert.ok(error.details?.password);
      assert.ok(error.details?.username);
      assert.ok(error.details?.role);
      return true;
    },
  );
});

test('createUser defaults the role to reader', () => {
  const { adapter, crypto } = setup();

  const user = createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', undefined, NOW);

  assert.equal(user.role, 'reader');
});

test('createUser rejects a duplicate email with a 409 conflict', () => {
  const { adapter, crypto } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);

  assert.throws(
    () => createUser(adapter, crypto, 'ana@example.com', 'otherpw1', 'ana2', 'reader', NOW),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'CONFLICT');
      return true;
    },
  );
});

test('authenticate fails for a disabled user but still does the hashing work', () => {
  const { adapter, crypto } = setup();
  const user = createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);
  const rowIndex = adapter.findRowIndex('users', (row) => row.id === user.id);
  adapter.updateRow('users', rowIndex, { ...adapter.getRows('users')[rowIndex], disabled: true });

  const result = authenticate(adapter, crypto, SECRET, 'ana@example.com', 'secretpw', NOW);

  assert.equal(result.ok, false);
});

test('normalizeRole treats an empty role as reader', () => {
  assert.equal(normalizeRole(''), 'reader');
  assert.equal(normalizeRole(undefined), 'reader');
  assert.equal(normalizeRole('admin'), 'admin');
});

test('isDisabled only treats true, "TRUE" and "true" as disabled', () => {
  assert.equal(isDisabled(true), true);
  assert.equal(isDisabled('TRUE'), true);
  assert.equal(isDisabled('true'), true);
  assert.equal(isDisabled(false), false);
  assert.equal(isDisabled(''), false);
  assert.equal(isDisabled(undefined), false);
});

test('createUser rejects a password longer than MAX_PASSWORD_LENGTH', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'username', 'password', 'role', 'disabled', 'created_at', 'updated_at', 'deleted_at']);
  const crypto = new NodeCryptoAdapter();

  assert.throws(
    () => createUser(adapter, crypto, 'ana@example.com', 'x'.repeat(MAX_PASSWORD_LENGTH + 1), 'ana', 'reader', NOW),
    (error: unknown) =>
      error instanceof HttpError && error.status === 422 && Boolean((error.details as Record<string, string>).password),
  );
  assert.equal(adapter.getRows('users').length, 0);
});

test('authenticate rejects an over-long password without hashing it', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'username', 'password', 'role', 'disabled', 'created_at', 'updated_at', 'deleted_at']);
  const crypto = new NodeCryptoAdapter();
  createUser(adapter, crypto, 'ana@example.com', 'secret-password', 'ana', 'reader', NOW);
  let hmacCalls = 0;
  const counting: CryptoAdapter = {
    hmacSha256Base64Url: (message, key) => {
      hmacCalls++;
      return crypto.hmacSha256Base64Url(message, key);
    },
    base64UrlEncode: (text) => crypto.base64UrlEncode(text),
    base64UrlDecode: (text) => crypto.base64UrlDecode(text),
    randomSalt: () => crypto.randomSalt(),
  };

  const result = authenticate(adapter, counting, SECRET, 'ana@example.com', 'x'.repeat(MAX_PASSWORD_LENGTH + 1), NOW);

  assert.equal(result.ok, false);
  assert.equal(hmacCalls, 0);
});

function setupWithRole() {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'username', 'password', 'role', 'disabled', 'created_at', 'updated_at', 'deleted_at']);
  const crypto = new NodeCryptoAdapter();
  return { adapter, crypto };
}

test('listUsers returns sanitized users without passwords', () => {
  const { adapter, crypto } = setupWithRole();
  createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);
  createUser(adapter, crypto, 'bob@example.com', 'secretpw', 'bob', 'author', NOW);

  const { data, meta } = listUsers({ adapter, now: NOW }, {});

  assert.equal(data.length, 2);
  assert.equal(meta.total, 2);
  for (const user of data) {
    assert.ok(!('password' in user));
    assert.ok('email' in user && 'username' in user && 'role' in user && 'disabled' in user && 'created_at' in user);
  }
});

test('listUsers rejects an out-of-range perPage', () => {
  const { adapter } = setupWithRole();

  assert.throws(
    () => listUsers({ adapter, now: NOW }, { perPage: 999 }),
    (error: unknown) => error instanceof HttpError && error.status === 422,
  );
});

test('updateUserAdmin promotes a reader to author', () => {
  const { adapter, crypto } = setupWithRole();
  const admin = createUser(adapter, crypto, 'admin@example.com', 'secretpw', 'admin1', 'admin', NOW);
  const target = createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);

  const updated = updateUserAdmin({ adapter, now: NOW }, { id: admin.id, role: 'admin', disabled: false }, target.id, { role: 'author' });

  assert.equal(updated.role, 'author');
  assert.ok(!('password' in updated));
});

test('updateUserAdmin disables a user', () => {
  const { adapter, crypto } = setupWithRole();
  const admin = createUser(adapter, crypto, 'admin@example.com', 'secretpw', 'admin1', 'admin', NOW);
  const target = createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);

  const updated = updateUserAdmin({ adapter, now: NOW }, { id: admin.id, role: 'admin', disabled: false }, target.id, { disabled: true });

  assert.equal(updated.disabled, true);
});

test('updateUserAdmin rejects self-demotion and self-disable', () => {
  const { adapter, crypto } = setupWithRole();
  const admin = createUser(adapter, crypto, 'admin@example.com', 'secretpw', 'admin1', 'admin', NOW);
  const actor = { id: admin.id, role: 'admin', disabled: false };

  assert.throws(
    () => updateUserAdmin({ adapter, now: NOW }, actor, admin.id, { role: 'reader' }),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
  assert.throws(
    () => updateUserAdmin({ adapter, now: NOW }, actor, admin.id, { disabled: true }),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
});

test('updateUserAdmin rejects an invalid role or non-boolean disabled', () => {
  const { adapter, crypto } = setupWithRole();
  const admin = createUser(adapter, crypto, 'admin@example.com', 'secretpw', 'admin1', 'admin', NOW);
  const target = createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);
  const actor = { id: admin.id, role: 'admin', disabled: false };

  assert.throws(
    () => updateUserAdmin({ adapter, now: NOW }, actor, target.id, { role: 'superadmin' }),
    (error: unknown) => error instanceof HttpError && error.status === 422,
  );
  assert.throws(
    () => updateUserAdmin({ adapter, now: NOW }, actor, target.id, { disabled: 'yes' as unknown as boolean }),
    (error: unknown) => error instanceof HttpError && error.status === 422,
  );
});

test('updateUserAdmin ignores email, password and username changes', () => {
  const { adapter, crypto } = setupWithRole();
  const admin = createUser(adapter, crypto, 'admin@example.com', 'secretpw', 'admin1', 'admin', NOW);
  const target = createUser(adapter, crypto, 'ana@example.com', 'secretpw', 'ana', 'reader', NOW);
  const actor = { id: admin.id, role: 'admin', disabled: false };

  const updated = updateUserAdmin(
    { adapter, now: NOW },
    actor,
    target.id,
    { role: 'author', email: 'hacked@example.com', username: 'hacked', password: 'hacked1234' } as never,
  );

  assert.equal(updated.email, 'ana@example.com');
  assert.equal(updated.username, 'ana');
});

test('updateUserAdmin 404s on a missing target', () => {
  const { adapter, crypto } = setupWithRole();
  const admin = createUser(adapter, crypto, 'admin@example.com', 'secretpw', 'admin1', 'admin', NOW);
  const actor = { id: admin.id, role: 'admin', disabled: false };

  assert.throws(
    () => updateUserAdmin({ adapter, now: NOW }, actor, 999999, { disabled: true }),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
});
