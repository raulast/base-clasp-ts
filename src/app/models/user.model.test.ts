import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../../core/testing/in-memory-sheet-adapter.ts';
import { NodeCryptoAdapter } from '../../core/testing/node-crypto-adapter.ts';
import { hashPassword } from '../../core/auth.ts';
import type { CryptoAdapter } from '../../core/crypto-adapter.ts';
import { createUser, authenticate, findUserById, sanitizeUser } from './user.model.ts';

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

  const user = createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);

  assert.equal(user.email, 'ana@example.com');
  assert.ok(!('password' in user));
  const stored = adapter.getRows('users')[0];
  assert.notEqual(stored.password, 'secret');
});

test('createUser rejects a duplicate email', () => {
  const { adapter, crypto } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);

  assert.throws(() => createUser(adapter, crypto, 'ana@example.com', 'other', 'ana2', NOW));
});

test('createUser stores the username', () => {
  const { adapter, crypto } = setup();

  const user = createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);

  assert.equal(user.username, 'ana');
  assert.equal(adapter.getRows('users')[0].username, 'ana');
});

test('createUser rejects a duplicate username without writing', () => {
  const { adapter, crypto } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);

  assert.throws(
    () => createUser(adapter, crypto, 'other@example.com', 'secret', 'ana', NOW),
    /Username already taken/,
  );
  assert.equal(adapter.getRows('users').length, 1);
});

test('authenticate returns a token for the right credentials', () => {
  const { adapter, crypto } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);

  const result = authenticate(adapter, crypto, SECRET, 'ana@example.com', 'secret', NOW);

  assert.equal(result.ok, true);
  assert.ok(typeof result.token === 'string');
});

test('authenticate does equal HMAC work for an unknown email and a wrong password', () => {
  const { adapter, crypto } = setup();
  createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);

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
  const stored = hashPassword('secret', crypto);
  adapter.appendRow('users', { id: 1, email: 'seed@example.com', password: stored, created_at: 1, updated_at: 1, deleted_at: null });

  const result = authenticate(adapter, crypto, SECRET, 'seed@example.com', 'secret', NOW);

  assert.equal(result.ok, true);
});

test('findUserById returns the user without the password', () => {
  const { adapter, crypto } = setup();
  const created = createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);

  const found = findUserById(adapter, created.id);

  assert.ok(found);
  assert.equal(found?.email, 'ana@example.com');
  assert.ok(!found || !('password' in found));
});

test('findUserById returns null for an unknown id', () => {
  const { adapter } = setup();

  assert.equal(findUserById(adapter, 999), null);
});

test('sanitizeUser strips the password field', () => {
  const sanitized = sanitizeUser({ id: 1, email: 'ana@example.com', password: 'hashed' });

  assert.ok(!('password' in sanitized));
  assert.equal(sanitized.email, 'ana@example.com');
});
