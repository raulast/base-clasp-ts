import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdmin } from './admin.ts';

test('isAdmin matches an email in a comma-separated list', () => {
  assert.equal(isAdmin('ana@example.com', 'ana@example.com,bob@example.com'), true);
});

test('isAdmin trims whitespace around list entries', () => {
  assert.equal(isAdmin('bob@example.com', 'ana@example.com, bob@example.com '), true);
});

test('isAdmin is case-insensitive', () => {
  assert.equal(isAdmin('Ana@Example.com', 'ana@example.com'), true);
});

test('isAdmin rejects an email not in the list', () => {
  assert.equal(isAdmin('eve@example.com', 'ana@example.com,bob@example.com'), false);
});

test('isAdmin rejects an empty email', () => {
  assert.equal(isAdmin('', 'ana@example.com'), false);
});

test('isAdmin rejects when the list is empty', () => {
  assert.equal(isAdmin('ana@example.com', ''), false);
});

test('isAdmin ignores empty list entries so a blank email never matches a trailing comma', () => {
  assert.equal(isAdmin('   ', 'owner@example.com,'), false);
  assert.equal(isAdmin('owner@example.com', 'owner@example.com,'), true);
});
