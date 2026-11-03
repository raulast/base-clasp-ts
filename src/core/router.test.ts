import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from './router.ts';
import type { Request } from './router.ts';
import { HttpError } from './api.ts';

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

test('router exposes put, patch and delete helpers', () => {
  const router = new Router();
  router.put('/items/:id', () => ({ status: 200, body: 'put' }));
  router.patch('/items/:id', () => ({ status: 200, body: 'patch' }));
  router.delete('/items/:id', () => ({ status: 200, body: 'delete' }));

  assert.equal(router.dispatch(request({ path: '/items/1', method: 'PUT' })).body, 'put');
  assert.equal(router.dispatch(request({ path: '/items/1', method: 'PATCH' })).body, 'patch');
  assert.equal(router.dispatch(request({ path: '/items/1', method: 'DELETE' })).body, 'delete');
});

test(':param segment extracts a value into pathParams', () => {
  const router = new Router();
  router.get('/posts/:id', (req) => ({ status: 200, body: req.pathParams?.id }));

  const response = router.dispatch(request({ path: '/posts/42' }));

  assert.equal(response.body, '42');
});

test(':param value is decodeURIComponent-ed', () => {
  const router = new Router();
  router.get('/search/:term', (req) => ({ status: 200, body: req.pathParams?.term }));

  const response = router.dispatch(request({ path: '/search/hello%20world' }));

  assert.equal(response.body, 'hello world');
});

test('a malformed escape in a :param segment does not match', () => {
  const router = new Router();
  router.get('/search/:term', () => ({ status: 200, body: 'found' }));

  const response = router.dispatch(request({ path: '/search/%E0%A4%A' }));

  assert.equal(response.status, 404);
});

test('an empty segment does not match a :param', () => {
  const router = new Router();
  router.get('/posts/:id', () => ({ status: 200, body: 'found' }));

  const response = router.dispatch(request({ path: '/posts//edit' }));

  assert.equal(response.status, 404);
});

test('a static route wins over a param route regardless of registration order', () => {
  const router = new Router();
  router.get('/posts/:id', () => ({ status: 200, body: 'param' }));
  router.get('/posts/featured', () => ({ status: 200, body: 'static' }));

  const response = router.dispatch(request({ path: '/posts/featured' }));

  assert.equal(response.body, 'static');
});

test('a trailing slash is ignored for non-root paths', () => {
  const router = new Router();
  router.get('/a', () => ({ status: 200, body: 'a' }));

  const response = router.dispatch(request({ path: '/a/' }));

  assert.equal(response.body, 'a');
});

test('the root path / still matches exactly', () => {
  const router = new Router();
  router.get('/', () => ({ status: 200, body: 'root' }));

  const response = router.dispatch(request({ path: '/' }));

  assert.equal(response.body, 'root');
});

test('router.group applies a prefix and runs group middleware before route middleware', () => {
  const router = new Router();
  const order: string[] = [];
  router.group(
    '/api/v1',
    [
      (_req, next) => {
        order.push('group');
        return next();
      },
    ],
    (group) => {
      group.get(
        '/ping',
        () => ({ status: 200, body: 'pong' }),
        [
          (_req, next) => {
            order.push('route');
            return next();
          },
        ],
      );
    },
  );

  const response = router.dispatch(request({ path: '/api/v1/ping' }));

  assert.deepEqual(response, { status: 200, body: 'pong' });
  assert.deepEqual(order, ['group', 'route']);
});

test('nested groups stack prefix and middleware', () => {
  const router = new Router();
  const order: string[] = [];
  router.group('/api', [(_req, next) => { order.push('outer'); return next(); }], (outer) => {
    outer.group('/v1', [(_req, next) => { order.push('inner'); return next(); }], (inner) => {
      inner.get('/ping', () => ({ status: 200, body: 'pong' }));
    });
  });

  const response = router.dispatch(request({ path: '/api/v1/ping' }));

  assert.deepEqual(response, { status: 200, body: 'pong' });
  assert.deepEqual(order, ['outer', 'inner']);
});

test('method override: POST with _method PATCH dispatches to the PATCH handler and strips _method', () => {
  const router = new Router();
  router.patch('/items/:id', (req) => ({ status: 200, body: req.body }));

  const response = router.dispatch(request({ path: '/items/1', method: 'POST', body: { _method: 'PATCH', name: 'x' } }));

  assert.deepEqual(response.body, { name: 'x' });
});

test('method override: POST with _method DELETE dispatches to the DELETE handler', () => {
  const router = new Router();
  router.delete('/items/:id', () => ({ status: 200, body: 'deleted' }));

  const response = router.dispatch(request({ path: '/items/1', method: 'POST', body: { _method: 'DELETE' } }));

  assert.equal(response.body, 'deleted');
});

test('method override: POST with _method get (lowercase) dispatches to the GET handler', () => {
  const router = new Router();
  router.get('/items/:id', () => ({ status: 200, body: 'got' }));

  const response = router.dispatch(request({ path: '/items/1', method: 'POST', body: { _method: 'put' } }));

  assert.equal(response.status, 405);
});

test('method override: POST with _method put (lowercase) dispatches to the PUT handler', () => {
  const router = new Router();
  router.put('/items/:id', () => ({ status: 200, body: 'put' }));

  const response = router.dispatch(request({ path: '/items/1', method: 'POST', body: { _method: 'put' } }));

  assert.equal(response.body, 'put');
});

test('method override: invalid _method value returns 405', () => {
  const router = new Router();
  router.post('/items', () => ({ status: 200, body: 'posted' }));

  const response = router.dispatch(request({ path: '/items', method: 'POST', body: { _method: 'TRACE' } }));

  assert.equal(response.status, 405);
});

test('_method on a GET request (body) is ignored', () => {
  const router = new Router();
  router.get('/items', () => ({ status: 200, body: 'list' }));
  router.delete('/items', () => ({ status: 200, body: 'deleted' }));

  const response = router.dispatch(request({ path: '/items', method: 'GET', body: { _method: 'DELETE' } }));

  assert.equal(response.body, 'list');
});

test('_method on a GET request (params/query) is ignored', () => {
  const router = new Router();
  router.get('/items', () => ({ status: 200, body: 'list' }));

  const response = router.dispatch(request({ path: '/items', method: 'GET', params: { _method: 'DELETE' } }));

  assert.equal(response.body, 'list');
});

test('404 NOT_FOUND when no route matches the path for any method', () => {
  const router = new Router();
  router.get('/known', () => ({ status: 200, body: 'ok' }));

  const response = router.dispatch(request({ path: '/unknown' }));

  assert.equal(response.status, 404);
  assert.equal((response.body as { error: { code: string } }).error.code, 'NOT_FOUND');
});

test('405 METHOD_NOT_ALLOWED with sorted details.allowed when the path matches other methods', () => {
  const router = new Router();
  router.get('/items', () => ({ status: 200, body: 'list' }));
  router.delete('/items', () => ({ status: 200, body: 'deleted' }));
  router.post('/items', () => ({ status: 200, body: 'created' }));

  const response = router.dispatch(request({ path: '/items', method: 'PATCH' }));

  assert.equal(response.status, 405);
  const body = response.body as { error: { code: string; details: { allowed: string[] } } };
  assert.equal(body.error.code, 'METHOD_NOT_ALLOWED');
  assert.deepEqual(body.error.details.allowed, ['DELETE', 'GET', 'POST']);
});

test('an HttpError thrown by a handler becomes the matching error envelope', () => {
  const router = new Router();
  router.get('/boom', () => {
    throw new HttpError(409, 'CONFLICT', 'Already exists');
  });

  const response = router.dispatch(request({ path: '/boom' }));

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, { ok: false, status: 409, error: { code: 'CONFLICT', message: 'Already exists' } });
});

test('a plain Error thrown by a handler becomes a 500 INTERNAL envelope without the original message', () => {
  const router = new Router();
  router.get('/boom', () => {
    throw new Error('super secret stack detail');
  });

  const response = router.dispatch(request({ path: '/boom' }));

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { ok: false, status: 500, error: { code: 'INTERNAL', message: 'Internal server error' } });
  assert.ok(!JSON.stringify(response.body).includes('super secret stack detail'));
});

test('an HttpError thrown by middleware becomes the matching error envelope', () => {
  const router = new Router();
  router.get(
    '/guarded',
    () => ({ status: 200, body: 'ok' }),
    [
      () => {
        throw new HttpError(401, 'UNAUTHENTICATED', 'No token');
      },
    ],
  );

  const response = router.dispatch(request({ path: '/guarded' }));

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { ok: false, status: 401, error: { code: 'UNAUTHENTICATED', message: 'No token' } });
});
