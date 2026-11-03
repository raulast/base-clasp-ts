import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GasStorageAdapter } from './gas-storage-adapter.ts';
import { HttpError } from './api.ts';
import { MAX_UPLOAD_BYTES } from './media-rules.ts';

const globals = globalThis as Record<string, unknown>;

interface FakeBlob {
  bytes: number[];
  mimeType: string;
  name: string;
  getBytes: () => number[];
  getContentType: () => string;
}

interface FakeFile {
  id: string;
  blob: FakeBlob;
  trashed: boolean;
  sharing?: { accessLevel: string; permissionLevel: string };
  setTrashed: (value: boolean) => void;
  setSharing: (access: string, permission: string) => void;
  getBlob: () => FakeBlob;
  getId: () => string;
  getName: () => string;
}

let folders: Record<string, { createdFiles: FakeFile[] }>;
let filesById: Record<string, FakeFile>;
let nextFileId: number;

beforeEach(() => {
  folders = {};
  filesById = {};
  nextFileId = 1;

  globals.DriveApp = {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' },
    Permission: { VIEW: 'VIEW', NONE: 'NONE' },
    getFolderById: (folderId: string) => {
      folders[folderId] = folders[folderId] ?? { createdFiles: [] };
      return {
        createFile: (blob: FakeBlob) => {
          const id = String(nextFileId++);
          const file: FakeFile = {
            id,
            blob,
            trashed: false,
            setTrashed(value: boolean) {
              file.trashed = value;
            },
            setSharing(access: string, permission: string) {
              file.sharing = { accessLevel: access, permissionLevel: permission };
            },
            getBlob() {
              return file.blob;
            },
            getId() {
              return file.id;
            },
            getName() {
              return file.blob.name;
            },
          };
          filesById[id] = file;
          folders[folderId].createdFiles.push(file);
          return file;
        },
      };
    },
    getFileById: (fileId: string) => {
      const file = filesById[fileId];
      if (!file) {
        throw new Error(`Unknown fileId: ${fileId}`);
      }
      return file;
    },
  };

  globals.Utilities = {
    newBlob: (bytes: number[], mimeType: string, name: string): FakeBlob => ({
      bytes,
      mimeType,
      name,
      getBytes: () => bytes,
      getContentType: () => mimeType,
    }),
    base64Decode: (base64: string) => [...Buffer.from(base64, 'base64')],
    base64Encode: (bytes: number[]) => Buffer.from(bytes).toString('base64'),
  };
});

function base64Of(byteLength: number): string {
  return Buffer.alloc(byteLength, 'a').toString('base64');
}

test('saveFile creates a file in the given folder from the decoded blob', () => {
  const adapter = new GasStorageAdapter();

  const saved = adapter.saveFile({ folderId: 'folder-1', name: 'a.png', mimeType: 'image/png', base64: base64Of(10) });

  assert.equal(saved.size, 10);
  const file = filesById[saved.fileId];
  assert.equal(file.blob.mimeType, 'image/png');
  assert.equal(file.blob.name, 'a.png');
  assert.equal(file.blob.bytes.length, 10);
  assert.equal(folders['folder-1'].createdFiles.length, 1);
});

test('setPublic(true) shares anyone with link / view', () => {
  const adapter = new GasStorageAdapter();
  const saved = adapter.saveFile({ folderId: 'folder-1', name: 'a.png', mimeType: 'image/png', base64: base64Of(10) });

  adapter.setPublic(saved.fileId, true);

  assert.deepEqual(filesById[saved.fileId].sharing, { accessLevel: 'ANYONE_WITH_LINK', permissionLevel: 'VIEW' });
});

test('setPublic(false) shares private / none', () => {
  const adapter = new GasStorageAdapter();
  const saved = adapter.saveFile({ folderId: 'folder-1', name: 'a.png', mimeType: 'image/png', base64: base64Of(10) });

  adapter.setPublic(saved.fileId, false);

  assert.deepEqual(filesById[saved.fileId].sharing, { accessLevel: 'PRIVATE', permissionLevel: 'NONE' });
});

test('trash sets the file trashed', () => {
  const adapter = new GasStorageAdapter();
  const saved = adapter.saveFile({ folderId: 'folder-1', name: 'a.png', mimeType: 'image/png', base64: base64Of(10) });

  adapter.trash(saved.fileId);

  assert.equal(filesById[saved.fileId].trashed, true);
});

test('readBase64 returns the encoded blob bytes', () => {
  const adapter = new GasStorageAdapter();
  const saved = adapter.saveFile({ folderId: 'folder-1', name: 'a.png', mimeType: 'image/png', base64: base64Of(10) });

  const file = adapter.readBase64(saved.fileId);

  assert.equal(file.name, 'a.png');
  assert.equal(file.mimeType, 'image/png');
  assert.equal(file.size, 10);
  assert.equal(file.data, base64Of(10));
});

test('readBase64 refuses a file larger than MAX_UPLOAD_BYTES with 413', () => {
  const adapter = new GasStorageAdapter();
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

test('links returns the drive url, downloadUrl and embedUrl', () => {
  const adapter = new GasStorageAdapter();
  const saved = adapter.saveFile({ folderId: 'folder-1', name: 'a.png', mimeType: 'image/png', base64: base64Of(10) });

  const links = adapter.links(saved.fileId);

  assert.equal(links.url, `https://drive.google.com/file/d/${saved.fileId}/view`);
  assert.equal(links.downloadUrl, `https://drive.google.com/uc?export=download&id=${saved.fileId}`);
  assert.equal(links.embedUrl, `https://drive.google.com/file/d/${saved.fileId}/preview`);
  assert.equal(links.imageUrl, `https://drive.google.com/thumbnail?id=${saved.fileId}&sz=w1600`);
});
