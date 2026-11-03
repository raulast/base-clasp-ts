import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  mediaKind,
  decodedSize,
  validateUpload,
} from './media-rules.ts';
import { HttpError } from './api.ts';

function base64Of(byteLength: number): string {
  return Buffer.alloc(byteLength, 'a').toString('base64');
}

test('mediaKind classifies every allowed MIME type', () => {
  assert.equal(mediaKind('image/png'), 'image');
  assert.equal(mediaKind('image/jpeg'), 'image');
  assert.equal(mediaKind('image/gif'), 'image');
  assert.equal(mediaKind('image/webp'), 'image');
  assert.equal(mediaKind('video/mp4'), 'video');
  assert.equal(mediaKind('video/webm'), 'video');
  assert.equal(mediaKind('application/pdf'), 'document');
  assert.equal(
    mediaKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    'document',
  );
  assert.equal(mediaKind('application/zip'), 'document');
});

test('decodedSize is computed from base64 length and padding', () => {
  assert.equal(decodedSize(''), 0);
  assert.equal(decodedSize(base64Of(0)), 0);
  assert.equal(decodedSize(base64Of(1)), 1);
  assert.equal(decodedSize(base64Of(2)), 2);
  assert.equal(decodedSize(base64Of(3)), 3);
  assert.equal(decodedSize(base64Of(1000)), 1000);
  assert.equal(decodedSize(base64Of(MAX_UPLOAD_BYTES)), MAX_UPLOAD_BYTES);
});

test('validateUpload accepts every allowed MIME type', () => {
  for (const mimeType of ALLOWED_MIME_TYPES) {
    const result = validateUpload({ name: 'file.bin', mimeType, data: base64Of(10) });
    assert.equal(result.mimeType, mimeType);
    assert.equal(result.size, 10);
  }
});

test('validateUpload rejects a disallowed MIME type with 415', () => {
  assert.throws(
    () => validateUpload({ name: 'file.exe', mimeType: 'application/x-msdownload', data: base64Of(10) }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 415);
      assert.equal(error.code, 'UNSUPPORTED_MEDIA_TYPE');
      return true;
    },
  );
});

test('validateUpload accepts a decoded size exactly at the limit', () => {
  const result = validateUpload({ name: 'big.png', mimeType: 'image/png', data: base64Of(MAX_UPLOAD_BYTES) });
  assert.equal(result.size, MAX_UPLOAD_BYTES);
});

test('validateUpload rejects a decoded size one byte over the limit with 413', () => {
  assert.throws(
    () =>
      validateUpload({
        name: 'toobig.png',
        mimeType: 'image/png',
        data: base64Of(MAX_UPLOAD_BYTES + 1),
      }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 413);
      assert.equal(error.code, 'PAYLOAD_TOO_LARGE');
      return true;
    },
  );
});

test('validateUpload rejects invalid base64 with 422', () => {
  assert.throws(
    () => validateUpload({ name: 'file.png', mimeType: 'image/png', data: 'not-base64!!!' }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.ok((error as HttpError).details?.data);
      return true;
    },
  );
});

test('validateUpload rejects missing fields with 422 and per-field details', () => {
  assert.throws(
    () => validateUpload({ name: undefined, mimeType: undefined, data: undefined }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'VALIDATION_ERROR');
      const details = (error as HttpError).details as Record<string, unknown>;
      assert.ok(details.name);
      assert.ok(details.mimeType);
      assert.ok(details.data);
      return true;
    },
  );
});

test('validateUpload sanitizes a path-traversal name to a bare filename', () => {
  const result = validateUpload({ name: '../evil.pdf', mimeType: 'application/pdf', data: base64Of(10) });
  assert.equal(result.name, '..evil.pdf');
});

test('validateUpload strips control characters from the name', () => {
  const result = validateUpload({ name: 'file\u0000\u0007name.pdf', mimeType: 'application/pdf', data: base64Of(10) });
  assert.equal(result.name, 'filename.pdf');
});

test('validateUpload rejects a name that is empty after sanitizing', () => {
  assert.throws(
    () => validateUpload({ name: '/\\\u0000', mimeType: 'application/pdf', data: base64Of(10) }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'VALIDATION_ERROR');
      return true;
    },
  );
});

test('validateUpload caps the sanitized name at 120 characters', () => {
  const longName = `${'a'.repeat(200)}.pdf`;
  const result = validateUpload({ name: longName, mimeType: 'application/pdf', data: base64Of(10) });
  assert.equal(result.name.length, 120);
});

test('validateUpload rejects base64 whose length is not a multiple of 4 with 422', () => {
  assert.throws(
    () => validateUpload({ name: 'a.png', mimeType: 'image/png', data: 'abc' }),
    (error: unknown) => error instanceof HttpError && error.status === 422,
  );
});

test('validateUpload answers 413 for an oversized payload before validating its characters', () => {
  const oversizedAndInvalid = '!'.repeat(Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 8);

  assert.throws(
    () => validateUpload({ name: 'a.png', mimeType: 'image/png', data: oversizedAndInvalid }),
    (error: unknown) => error instanceof HttpError && error.status === 413,
  );
});
