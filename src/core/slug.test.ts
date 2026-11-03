import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './api.ts';
import { slugify } from './slug.ts';

test('slugify lowercases and dashes non-alphanumerics', () => {
  assert.equal(slugify('Hello World!'), 'hello-world');
});

test('slugify strips accents', () => {
  assert.equal(slugify('Árbol de Café'), 'arbol-de-cafe');
});

test('slugify collapses and trims dashes', () => {
  assert.equal(slugify('  --Foo   Bar--  '), 'foo-bar');
});

test('slugify truncates to 80 chars', () => {
  const long = 'a'.repeat(100);
  const result = slugify(long);
  assert.equal(result.length, 80);
});

test('slugify throws VALIDATION_ERROR when the result is empty', () => {
  assert.throws(() => slugify('!!!'), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 422);
    assert.equal(error.code, 'VALIDATION_ERROR');
    return true;
  });
});
