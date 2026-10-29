import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from './router.ts';
import type { Request } from './router.ts';

const request = (overrides: Partial<Request> = {}): Request => ({
  path: '/',
  method: 'GET',
  params: {},
  body: {},
  ...overrides,
});

test('dispatch calls the matching GET handler', () => {
  const router = new Router();
  router.get('/ping', () => ({ status: 200, body: 'pong' }));

  const response = router.dispatch(request({ path: '/ping' }));

  assert.deepEqual(response, { status: 200, body: 'pong' });
});

test('GET and POST on the same path are independent routes', () => {
  const router = new Router();
  router.get('/users', () => ({ status: 200, body: 'list' }));
  router.post('/users', () => ({ status: 201, body: 'created' }));

  assert.deepEqual(router.dispatch(request({ path: '/users', method: 'GET' })), { status: 200, body: 'list' });
  assert.deepEqual(router.dispatch(request({ path: '/users', method: 'POST' })), { status: 201, body: 'created' });
});

test('dispatch returns 404 when no route matches', () => {
  const router = new Router();

  const response = router.dispatch(request({ path: '/missing' }));

  assert.equal(response.status, 404);
});

test('middleware runs before the handler and can read the request', () => {
  const router = new Router();
  const seen: string[] = [];
  router.get(
    '/greet',
    (req) => ({ status: 200, body: `hello ${req.params.name}` }),
    [
      (req, next) => {
        seen.push(req.params.name ?? '');
        return next();
      },
    ],
  );

  const response = router.dispatch(request({ path: '/greet', params: { name: 'ana' } }));

  assert.deepEqual(response, { status: 200, body: 'hello ana' });
  assert.deepEqual(seen, ['ana']);
});

test('middleware can short-circuit by not calling next', () => {
  const router = new Router();
  router.get('/secret', () => ({ status: 200, body: 'secret' }), [
    () => ({ status: 401, body: 'unauthorized' }),
  ]);

  const response = router.dispatch(request({ path: '/secret' }));

  assert.deepEqual(response, { status: 401, body: 'unauthorized' });
});

test('middleware can wrap the response after calling next', () => {
  const router = new Router();
  router.get('/wrapped', () => ({ status: 200, body: 'inner' }), [
    (_req, next) => {
      const response = next();
      return { status: response.status, body: `[${response.body}]` };
    },
  ]);

  const response = router.dispatch(request({ path: '/wrapped' }));

  assert.deepEqual(response, { status: 200, body: '[inner]' });
});

test('multiple middleware run in registration order', () => {
  const router = new Router();
  const order: string[] = [];
  router.get('/ordered', () => ({ status: 200, body: 'ok' }), [
    (_req, next) => {
      order.push('first');
      return next();
    },
    (_req, next) => {
      order.push('second');
      return next();
    },
  ]);

  router.dispatch(request({ path: '/ordered' }));

  assert.deepEqual(order, ['first', 'second']);
});
