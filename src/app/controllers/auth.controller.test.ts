import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../../core/testing/in-memory-sheet-adapter.ts';
import { NodeCryptoAdapter } from '../../core/testing/node-crypto-adapter.ts';
import type { CryptoAdapter } from '../../core/crypto-adapter.ts';
import { createUser, login } from './auth.controller.ts';

const NOW = () => new Date(1700000000000);

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

test('login does equal HMAC work for an unknown email and a wrong password', () => {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('users', ['id', 'email', 'username', 'password', 'created_at', 'updated_at', 'deleted_at']);
  const crypto = new NodeCryptoAdapter();
  createUser(adapter, crypto, 'ana@example.com', 'secret', 'ana', NOW);

  const counter = countingCrypto(crypto);
  login(adapter, counter.adapter, 'secret', 'warm-the-dummy-hash-cache@example.com', 'whatever', NOW);
  counter.reset();

  login(adapter, counter.adapter, 'secret', 'nobody@example.com', 'whatever', NOW);
  const unknownCalls = counter.calls();
  counter.reset();

  login(adapter, counter.adapter, 'secret', 'ana@example.com', 'wrong-password', NOW);
  const wrongCalls = counter.calls();

  assert.equal(unknownCalls, wrongCalls);
  assert.ok(unknownCalls > 0);
});
