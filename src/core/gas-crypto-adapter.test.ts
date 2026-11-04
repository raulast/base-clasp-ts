import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GasCryptoAdapter, getScriptSecret, SECRET_CACHE_SECONDS } from './gas-crypto-adapter.ts';

const globals = globalThis as Record<string, unknown>;
let properties: Record<string, string | null> = {};
let propertyReads = 0;
let cache: Map<string, { value: string; ttl: number }> = new Map();
let cacheBroken = false;

beforeEach(() => {
  properties = {};
  propertyReads = 0;
  cache = new Map();
  cacheBroken = false;
  globals.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (name: string) => {
        propertyReads++;
        return properties[name] ?? null;
      },
    }),
  };
  globals.CacheService = {
    getScriptCache: () => ({
      get: (key: string) => {
        if (cacheBroken) throw new Error('cache unavailable');
        return cache.get(key)?.value ?? null;
      },
      put: (key: string, value: string, ttl: number) => {
        if (cacheBroken) throw new Error('cache unavailable');
        cache.set(key, { value, ttl });
      },
    }),
  };
  globals.Utilities = {
    Charset: { UTF_8: 'UTF-8' },
    base64DecodeWebSafe: (text: string) => {
      if (text.length % 4 !== 0) throw new Error(`unpadded base64: ${text}`);
      return [...Buffer.from(text, 'base64url')];
    },
    newBlob: (bytes: number[]) => ({
      getDataAsString: (charset?: string) => {
        assert.equal(charset, 'UTF-8');
        return Buffer.from(bytes).toString('utf8');
      },
    }),
  };
});

test('getScriptSecret returns a set property', () => {
  properties.JWT_SECRET = 's3cret';
  assert.equal(getScriptSecret('JWT_SECRET'), 's3cret');
});

test('getScriptSecret throws for a missing or empty property', () => {
  assert.throws(() => getScriptSecret('JWT_SECRET'), /Missing script property: JWT_SECRET/);
  properties.JWT_SECRET = '';
  assert.throws(() => getScriptSecret('JWT_SECRET'), /Missing script property: JWT_SECRET/);
});

test('getScriptSecret serves repeated reads from the script cache, not Properties', () => {
  properties.JWT_SECRET = 's3cret';

  assert.equal(getScriptSecret('JWT_SECRET'), 's3cret');
  assert.equal(getScriptSecret('JWT_SECRET'), 's3cret');

  assert.equal(propertyReads, 1);
  assert.deepEqual(cache.get('script-secret:JWT_SECRET'), { value: 's3cret', ttl: SECRET_CACHE_SECONDS });
  assert.equal(SECRET_CACHE_SECONDS, 600);
});

test('getScriptSecret reads Properties again when the cache evicted the value', () => {
  properties.JWT_SECRET = 's3cret';
  getScriptSecret('JWT_SECRET');
  cache.clear();

  assert.equal(getScriptSecret('JWT_SECRET'), 's3cret');
  assert.equal(propertyReads, 2);
});

test('getScriptSecret never caches a missing or empty value', () => {
  properties.JWT_SECRET = '';

  assert.throws(() => getScriptSecret('JWT_SECRET'), /Missing script property: JWT_SECRET/);
  assert.equal(cache.size, 0);
});

test('getScriptSecret falls back to Properties when the cache fails or does not exist', () => {
  properties.JWT_SECRET = 's3cret';
  cacheBroken = true;
  assert.equal(getScriptSecret('JWT_SECRET'), 's3cret');

  delete globals.CacheService;
  assert.equal(getScriptSecret('JWT_SECRET'), 's3cret');
});

test('base64UrlDecode restores padding for every length and decodes UTF-8', () => {
  const adapter = new GasCryptoAdapter();
  for (const text of ['ab', 'abc', 'abcd', 'ñandú']) {
    const encoded = Buffer.from(text, 'utf8').toString('base64url');
    assert.equal(adapter.base64UrlDecode(encoded), text);
  }
});
