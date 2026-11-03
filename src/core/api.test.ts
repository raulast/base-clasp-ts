import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, ok, created, fail, isEnvelope, notFound, forbidden, unauthenticated, validationError, conflict } from './api.ts';

test('ok wraps data with status 200 and no meta key when undefined', () => {
  const response = ok({ id: 1 });

  assert.deepEqual(response, { status: 200, body: { ok: true, status: 200, data: { id: 1 } } });
  assert.ok(!('meta' in (response.body as object)));
});

test('ok includes meta when provided', () => {
  const meta = { page: 1, perPage: 10, total: 1, pages: 1 };
  const response = ok({ id: 1 }, meta);

  assert.deepEqual(response, { status: 200, body: { ok: true, status: 200, data: { id: 1 }, meta } });
});

test('created wraps data with status 201', () => {
  const response = created({ id: 1 });

  assert.deepEqual(response, { status: 201, body: { ok: true, status: 201, data: { id: 1 } } });
});

test('fail builds an error envelope without details key when undefined', () => {
  const response = fail(404, 'NOT_FOUND', 'Not found');

  assert.deepEqual(response, { status: 404, body: { ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Not found' } } });
  assert.ok(!('details' in (response.body as { error: object }).error));
});

test('fail includes details when provided', () => {
  const response = fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', { allowed: ['GET', 'POST'] });

  assert.deepEqual(response, {
    status: 405,
    body: { ok: false, status: 405, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', details: { allowed: ['GET', 'POST'] } } },
  });
});

test('isEnvelope recognizes success and error envelopes', () => {
  assert.ok(isEnvelope(ok({}).body));
  assert.ok(isEnvelope(fail(404, 'NOT_FOUND', 'Not found').body));
});

test('isEnvelope rejects plain objects', () => {
  assert.ok(!isEnvelope({ foo: 'bar' }));
  assert.ok(!isEnvelope(null));
  assert.ok(!isEnvelope('string'));
});

test('HttpError carries status, code and optional details', () => {
  const error = new HttpError(409, 'CONFLICT', 'Conflict', { field: 'slug' });

  assert.equal(error.status, 409);
  assert.equal(error.code, 'CONFLICT');
  assert.equal(error.message, 'Conflict');
  assert.deepEqual(error.details, { field: 'slug' });
  assert.ok(error instanceof Error);
});

test('HttpError works without details', () => {
  const error = new HttpError(401, 'UNAUTHENTICATED', 'Unauthenticated');

  assert.equal(error.details, undefined);
});

test('notFound factory produces a 404 NOT_FOUND HttpError', () => {
  const error = notFound('Not found');

  assert.ok(error instanceof HttpError);
  assert.equal(error.status, 404);
  assert.equal(error.code, 'NOT_FOUND');
  assert.equal(error.message, 'Not found');
});

test('forbidden factory produces a 403 FORBIDDEN HttpError', () => {
  const error = forbidden('Forbidden');

  assert.equal(error.status, 403);
  assert.equal(error.code, 'FORBIDDEN');
});

test('unauthenticated factory produces a 401 UNAUTHENTICATED HttpError', () => {
  const error = unauthenticated('Unauthenticated');

  assert.equal(error.status, 401);
  assert.equal(error.code, 'UNAUTHENTICATED');
});

test('validationError factory produces a 422 VALIDATION_ERROR HttpError with details', () => {
  const error = validationError({ email: 'invalid' });

  assert.equal(error.status, 422);
  assert.equal(error.code, 'VALIDATION_ERROR');
  assert.deepEqual(error.details, { email: 'invalid' });
});

test('conflict factory produces a 409 CONFLICT HttpError', () => {
  const error = conflict('Conflict');

  assert.equal(error.status, 409);
  assert.equal(error.code, 'CONFLICT');
});
