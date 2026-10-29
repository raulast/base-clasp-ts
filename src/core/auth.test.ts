import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeCryptoAdapter } from './testing/node-crypto-adapter.ts';
import { hashPassword, verifyPassword, signJwt, verifyJwt, MAX_PASSWORD_ITERATIONS } from './auth.ts';

const crypto = new NodeCryptoAdapter();
const FIXED_NOW = () => new Date(1700000000000);

test('hashPassword stores iterations$salt$hash and honors the iterations count', () => {
  const stored = hashPassword('secret', crypto, 500);
  const parts = stored.split('$');

  assert.equal(parts.length, 3);
  assert.equal(parts[0], '500');
  assert.ok(parts[1].length > 0);
  assert.ok(parts[2].length > 0);
});

test('hashing the same password twice gives different stored values', () => {
  const first = hashPassword('secret', crypto);
  const second = hashPassword('secret', crypto);

  assert.notEqual(first, second);
});

test('verifyPassword returns true for the right password', () => {
  const stored = hashPassword('secret', crypto);

  assert.equal(verifyPassword('secret', stored, crypto), true);
});

test('verifyPassword returns false for a wrong password', () => {
  const stored = hashPassword('secret', crypto);

  assert.equal(verifyPassword('wrong', stored, crypto), false);
});

test('verifyPassword returns false for a malformed stored string', () => {
  assert.equal(verifyPassword('secret', 'not-a-valid-stored-value', crypto), false);
  assert.equal(verifyPassword('secret', '1000$onlysalt', crypto), false);
});

test('signJwt and verifyJwt round-trip returns the payload with iat/exp', () => {
  const token = signJwt({ sub: 'u1' }, 'secret', 3600, crypto, FIXED_NOW);
  const result = verifyJwt(token, 'secret', crypto, FIXED_NOW);

  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.payload.sub, 'u1');
    assert.equal(result.payload.iat, Math.floor(FIXED_NOW().getTime() / 1000));
    assert.equal(result.payload.exp, Math.floor(FIXED_NOW().getTime() / 1000) + 3600);
  }
});

test('verifyJwt rejects a tampered payload with signature', () => {
  const token = signJwt({ sub: 'u1' }, 'secret', 3600, crypto, FIXED_NOW);
  const [header, payload, signature] = token.split('.');
  const tamperedPayload = crypto.base64UrlEncode(
    crypto.base64UrlDecode(payload).replace('u1', 'u2'),
  );
  const tampered = `${header}.${tamperedPayload}.${signature}`;

  const result = verifyJwt(tampered, 'secret', crypto, FIXED_NOW);

  assert.equal(result.valid, false);
  assert.equal(result.valid === false && result.reason, 'signature');
});

test('verifyJwt rejects a wrong secret with signature', () => {
  const token = signJwt({ sub: 'u1' }, 'secret', 3600, crypto, FIXED_NOW);

  const result = verifyJwt(token, 'wrong-secret', crypto, FIXED_NOW);

  assert.equal(result.valid, false);
  assert.equal(result.valid === false && result.reason, 'signature');
});

test('verifyJwt rejects an expired token', () => {
  const token = signJwt({ sub: 'u1' }, 'secret', 10, crypto, FIXED_NOW);
  const later = () => new Date(FIXED_NOW().getTime() + 11000);

  const result = verifyJwt(token, 'secret', crypto, later);

  assert.equal(result.valid, false);
  assert.equal(result.valid === false && result.reason, 'expired');
});

test('verifyJwt rejects header alg "none"', () => {
  const header = crypto.base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const now = Math.floor(FIXED_NOW().getTime() / 1000);
  const payload = crypto.base64UrlEncode(JSON.stringify({ sub: 'u1', iat: now, exp: now + 3600 }));
  const token = `${header}.${payload}.`;

  const result = verifyJwt(token, 'secret', crypto, FIXED_NOW);

  assert.equal(result.valid, false);
  assert.equal(result.valid === false && result.reason, 'algorithm');
});

test('verifyJwt rejects a non-HS256 algorithm', () => {
  const header = crypto.base64UrlEncode(JSON.stringify({ alg: 'HS512', typ: 'JWT' }));
  const now = Math.floor(FIXED_NOW().getTime() / 1000);
  const payload = crypto.base64UrlEncode(JSON.stringify({ sub: 'u1', iat: now, exp: now + 3600 }));
  const signature = crypto.hmacSha256Base64Url(`${header}.${payload}`, 'secret');
  const token = `${header}.${payload}.${signature}`;

  const result = verifyJwt(token, 'secret', crypto, FIXED_NOW);

  assert.equal(result.valid, false);
  assert.equal(result.valid === false && result.reason, 'algorithm');
});

test('verifyJwt rejects a token without exp', () => {
  const header = crypto.base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(FIXED_NOW().getTime() / 1000);
  const payload = crypto.base64UrlEncode(JSON.stringify({ sub: 'u1', iat: now }));
  const signature = crypto.hmacSha256Base64Url(`${header}.${payload}`, 'secret');
  const token = `${header}.${payload}.${signature}`;

  const result = verifyJwt(token, 'secret', crypto, FIXED_NOW);

  assert.equal(result.valid, false);
  assert.equal(result.valid === false && result.reason, 'malformed');
});

test('verifyJwt rejects a token that is not three dot-separated parts', () => {
  const result = verifyJwt('only.two', 'secret', crypto, FIXED_NOW);

  assert.equal(result.valid, false);
  assert.equal(result.valid === false && result.reason, 'malformed');
});

test('verifyJwt rejects bad base64 in a segment', () => {
  const result = verifyJwt('not-base64-!!.not-base64-!!.sig', 'secret', crypto, FIXED_NOW);

  assert.equal(result.valid, false);
  assert.equal(result.valid === false && result.reason, 'malformed');
});

test('verifyJwt rejects bad JSON in a segment', () => {
  const header = crypto.base64UrlEncode('not json');
  const now = Math.floor(FIXED_NOW().getTime() / 1000);
  const payload = crypto.base64UrlEncode(JSON.stringify({ sub: 'u1', iat: now, exp: now + 3600 }));
  const token = `${header}.${payload}.sig`;

  const result = verifyJwt(token, 'secret', crypto, FIXED_NOW);

  assert.equal(result.valid, false);
  assert.equal(result.valid === false && result.reason, 'malformed');
});

test('NodeCryptoAdapter hmacSha256Base64Url matches the jwt.io HS256 example', () => {
  const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
  const payload = 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ';
  const secret = 'your-256-bit-secret';

  const signature = crypto.hmacSha256Base64Url(`${header}.${payload}`, secret);

  assert.equal(signature, 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
});

const countingCrypto = () => {
  let hmacCalls = 0;
  const adapter = {
    hmacSha256Base64Url: (message: string, key: string) => {
      hmacCalls++;
      return crypto.hmacSha256Base64Url(message, key);
    },
    base64UrlEncode: (text: string) => crypto.base64UrlEncode(text),
    base64UrlDecode: (text: string) => crypto.base64UrlDecode(text),
    randomSalt: () => crypto.randomSalt(),
  };
  return { adapter, calls: () => hmacCalls };
};

test('verifyPassword rejects stored iterations above the maximum without hashing', () => {
  const counter = countingCrypto();
  const stored = `${MAX_PASSWORD_ITERATIONS + 1}$salt$hash`;

  assert.equal(verifyPassword('secret', stored, counter.adapter), false);
  assert.equal(counter.calls(), 0);
});

test('verifyPassword rejects zero, negative and non-numeric stored iterations without hashing', () => {
  const counter = countingCrypto();

  for (const iterations of ['0', '-5', 'abc', '1.5']) {
    assert.equal(verifyPassword('secret', `${iterations}$salt$hash`, counter.adapter), false);
  }
  assert.equal(counter.calls(), 0);
});

test('hashPassword throws a RangeError for iterations outside 1..MAX_PASSWORD_ITERATIONS', () => {
  assert.throws(() => hashPassword('secret', crypto, 0), RangeError);
  assert.throws(() => hashPassword('secret', crypto, MAX_PASSWORD_ITERATIONS + 1), RangeError);
});

test('verifyJwt rejects a non-numeric exp as malformed', () => {
  const header = crypto.base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = crypto.base64UrlEncode(JSON.stringify({ exp: '9999999999' }));
  const signature = crypto.hmacSha256Base64Url(`${header}.${payload}`, 'k');

  assert.deepEqual(verifyJwt(`${header}.${payload}.${signature}`, 'k', crypto, FIXED_NOW), {
    valid: false,
    reason: 'malformed',
  });
});
