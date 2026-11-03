import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canManageUsers } from './user.policy.ts';

test('canManageUsers allows a non-disabled admin', () => {
  assert.equal(canManageUsers({ id: 1, role: 'admin', disabled: false }), true);
});

test('canManageUsers rejects a disabled admin', () => {
  assert.equal(canManageUsers({ id: 1, role: 'admin', disabled: true }), false);
});

test('canManageUsers rejects non-admin roles', () => {
  assert.equal(canManageUsers({ id: 1, role: 'author', disabled: false }), false);
  assert.equal(canManageUsers({ id: 1, role: 'reader', disabled: false }), false);
});

test('canManageUsers rejects an anonymous caller', () => {
  assert.equal(canManageUsers(null), false);
});
