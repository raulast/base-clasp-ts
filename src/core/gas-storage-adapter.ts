import type { StorageAdapter, SaveFileInput, SavedFile, MediaFile, MediaLinks } from './storage-adapter.ts';
import { HttpError } from './api.ts';
import { decodedSize, MAX_UPLOAD_BYTES } from './media-rules.ts';

/**
 * StorageAdapter over DriveApp. Only touches ids stored in the media
 * sheet; callers never pass user-supplied folder/file ids beyond
 * saveFile's folderId.
 */
export class GasStorageAdapter implements StorageAdapter {
  saveFile(input: SaveFileInput): SavedFile {
    const bytes = Utilities.base64Decode(input.base64);
    const blob = Utilities.newBlob(bytes, input.mimeType, input.name);
    const folder = DriveApp.getFolderById(input.folderId);
    const file = folder.createFile(blob);
    return { fileId: file.getId(), size: decodedSize(input.base64) };
  }

  setPublic(fileId: string, isPublic: boolean): void {
    const file = DriveApp.getFileById(fileId);
    if (isPublic) {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } else {
      file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    }
  }

  trash(fileId: string): void {
    DriveApp.getFileById(fileId).setTrashed(true);
  }

  readBase64(fileId: string): MediaFile {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const bytes = blob.getBytes();
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'File exceeds the maximum allowed size');
    }
    return {
      name: file.getName(),
      mimeType: blob.getContentType() ?? '',
      size: bytes.length,
      data: Utilities.base64Encode(bytes),
    };
  }

  links(fileId: string): MediaLinks {
    return {
      url: `https://drive.google.com/file/d/${fileId}/view`,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
      embedUrl: `https://drive.google.com/file/d/${fileId}/preview`,
    };
  }
}
