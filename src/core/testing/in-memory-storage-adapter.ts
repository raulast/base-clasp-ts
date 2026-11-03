import type { StorageAdapter, SaveFileInput, SavedFile, MediaFile, MediaLinks } from '../storage-adapter.ts';
import { HttpError } from '../api.ts';
import { decodedSize, MAX_UPLOAD_BYTES } from '../media-rules.ts';

export interface InMemoryFile {
  folderId: string;
  name: string;
  mimeType: string;
  base64: string;
  size: number;
  isPublic: boolean;
  trashed: boolean;
}

export class InMemoryStorageAdapter implements StorageAdapter {
  files = new Map<string, InMemoryFile>();
  private nextId = 1;

  saveFile(input: SaveFileInput): SavedFile {
    const fileId = String(this.nextId++);
    const size = decodedSize(input.base64);
    this.files.set(fileId, {
      folderId: input.folderId,
      name: input.name,
      mimeType: input.mimeType,
      base64: input.base64,
      size,
      isPublic: false,
      trashed: false,
    });
    return { fileId, size };
  }

  private getFile(fileId: string): InMemoryFile {
    const file = this.files.get(fileId);
    if (!file) {
      throw new Error(`Unknown fileId: ${fileId}`);
    }
    return file;
  }

  setPublic(fileId: string, isPublic: boolean): void {
    this.getFile(fileId).isPublic = isPublic;
  }

  trash(fileId: string): void {
    this.getFile(fileId).trashed = true;
  }

  readBase64(fileId: string): MediaFile {
    const file = this.getFile(fileId);
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'File exceeds the maximum allowed size');
    }
    return { name: file.name, mimeType: file.mimeType, size: file.size, data: file.base64 };
  }

  links(fileId: string): MediaLinks {
    this.getFile(fileId);
    return {
      url: `https://drive.google.com/file/d/${fileId}/view`,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
      embedUrl: `https://drive.google.com/file/d/${fileId}/preview`,
      imageUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`,
    };
  }
}
