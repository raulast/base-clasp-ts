import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageAdapter } from './in-memory-storage-adapter.ts';
import { HttpError } from '../api.ts';
import { MAX_UPLOAD_BYTES } from '../media-rules.ts';

function base64Of(byteLength: number): string {
  return Buffer.alloc(byteLength, 'a').toString('base64');
}

test('saveFile stores the file in the given folder with the decoded blob', () => {
  const adapter = new InMemoryStorageAdapter();
  const saved = adapter.saveFile({ folderId: 'folder-1', name: 'a.png', mimeType: 'image/png', base64: base64Of(10) });

  assert.equal(saved.size, 10);
  assert.ok(saved.fileId);
  const stored = adapter.files.get(saved.fileId);
  assert.ok(stored);
  assert.equal(stored?.folderId, 'folder-1');
  assert.equal(stored?.mimeType, 'image/png');
});

test('setPublic records sharing calls for public and private', () => {
  const adapter = new InMemoryStorageAdapter();
  const saved = adapter.saveFile({ folderId: 'folder-1', name: 'a.png', mimeType: 'image/png', base64: base64Of(10) });

  adapter.setPublic(saved.fileId, true);
  assert.equal(adapter.files.get(saved.fileId)?.isPublic, true);

  adapter.setPublic(saved.fileId, false);
  assert.equal(adapter.files.get(saved.fileId)?.isPublic, false);
});

test('trash marks the file as trashed', () => {
  const adapter = new InMemoryStorageAdapter();
  const saved = adapter.saveFile({ folderId: 'folder-1', name: 'a.png', mimeType: 'image/png', base64: base64Of(10) });

  adapter.trash(saved.fileId);

  assert.equal(adapter.files.get(saved.fileId)?.trashed, true);
});

test('readBase64 returns the stored file', () => {
  const adapter = new InMemoryStorageAdapter();
  const saved = adapter.saveFile({ folderId: 'folder-1', name: 'a.png', mimeType: 'image/png', base64: base64Of(10) });

  const file = adapter.readBase64(saved.fileId);

  assert.equal(file.name, 'a.png');
  assert.equal(file.mimeType, 'image/png');
  assert.equal(file.size, 10);
  assert.equal(file.data, base64Of(10));
});

test('readBase64 refuses a file larger than MAX_UPLOAD_BYTES with 413', () => {
  const adapter = new InMemoryStorageAdapter();
  const saved = adapter.saveFile({
    folderId: 'folder-1',
    name: 'big.png',
    mimeType: 'image/png',
    base64: base64Of(MAX_UPLOAD_BYTES + 1),
  });

  assert.throws(
    () => adapter.readBase64(saved.fileId),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 413);
      assert.equal(error.code, 'PAYLOAD_TOO_LARGE');
      return true;
    },
  );
});

test('links returns the url, downloadUrl and embedUrl shape', () => {
  const adapter = new InMemoryStorageAdapter();
  const saved = adapter.saveFile({ folderId: 'folder-1', name: 'a.png', mimeType: 'image/png', base64: base64Of(10) });

  const links = adapter.links(saved.fileId);

  assert.equal(links.url, `https://drive.google.com/file/d/${saved.fileId}/view`);
  assert.equal(links.downloadUrl, `https://drive.google.com/uc?export=download&id=${saved.fileId}`);
  assert.equal(links.embedUrl, `https://drive.google.com/file/d/${saved.fileId}/preview`);
});
