import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestFromEvent } from './http.ts';

test('requestFromEvent maps e.parameter.route to request.path', () => {
  const request = requestFromEvent({ parameter: { route: '/login' } }, 'POST');
  assert.equal(request.path, '/login');
  assert.equal(request.method, 'POST');
});

test('requestFromEvent defaults path to / when route is missing', () => {
  const request = requestFromEvent({ parameter: {} }, 'GET');
  assert.equal(request.path, '/');
});

test('requestFromEvent copies e.parameter into params', () => {
  const request = requestFromEvent({ parameter: { route: '/x', foo: 'bar' } }, 'GET');
  assert.deepEqual(request.params, { route: '/x', foo: 'bar' });
});

test('requestFromEvent parses a JSON object postData body', () => {
  const request = requestFromEvent(
    { parameter: {}, postData: { contents: '{"email":"a@b.com","password":"secret"}' } },
    'POST',
  );
  assert.deepEqual(request.body, { email: 'a@b.com', password: 'secret' });
});

test('requestFromEvent falls back to an empty body when postData is missing', () => {
  const request = requestFromEvent({ parameter: {} }, 'GET');
  assert.deepEqual(request.body, {});
});

test('requestFromEvent never throws on malformed JSON', () => {
  const request = requestFromEvent({ parameter: {}, postData: { contents: 'not json' } }, 'POST');
  assert.deepEqual(request.body, {});
});

test('requestFromEvent falls back to an empty body when JSON is not an object', () => {
  const request = requestFromEvent({ parameter: {}, postData: { contents: '[1,2,3]' } }, 'POST');
  assert.deepEqual(request.body, {});
});
