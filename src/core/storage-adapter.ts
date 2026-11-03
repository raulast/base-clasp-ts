export interface SaveFileInput {
  folderId: string;
  name: string;
  mimeType: string;
  base64: string;
}

export interface SavedFile {
  fileId: string;
  size: number;
}

export interface MediaFile {
  name: string;
  mimeType: string;
  size: number;
  data: string;
}

export interface MediaLinks {
  url: string;
  downloadUrl: string;
  embedUrl: string;
}

export interface StorageAdapter {
  saveFile(input: SaveFileInput): SavedFile;
  setPublic(fileId: string, isPublic: boolean): void;
  trash(fileId: string): void;
  readBase64(fileId: string): MediaFile;
  links(fileId: string): MediaLinks;
}
