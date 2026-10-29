import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GasCryptoAdapter, getScriptSecret } from './gas-crypto-adapter.ts';

const globals = globalThis as Record<string, unknown>;
let properties: Record<string, string | null> = {};

beforeEach(() => {
  properties = {};
  globals.PropertiesService = {
    getScriptProperties: () => ({ getProperty: (name: string) => properties[name] ?? null }),
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

test('base64UrlDecode restores padding for every length and decodes UTF-8', () => {
  const adapter = new GasCryptoAdapter();
  for (const text of ['ab', 'abc', 'abcd', 'ñandú']) {
    const encoded = Buffer.from(text, 'utf8').toString('base64url');
    assert.equal(adapter.base64UrlDecode(encoded), text);
  }
});
