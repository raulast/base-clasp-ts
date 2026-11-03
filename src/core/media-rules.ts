import { HttpError } from './api.ts';

export const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export type MediaKind = 'image' | 'video' | 'document';

export interface UploadInput {
  name: unknown;
  mimeType: unknown;
  data: unknown;
}

export interface SanitizedUpload {
  name: string;
  mimeType: AllowedMimeType;
  data: string;
  size: number;
}

const MAX_BASE64_LENGTH = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export function mediaKind(mimeType: string): MediaKind {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  return 'document';
}

export function decodedSize(base64: string): number {
  if (base64.length === 0) {
    return 0;
  }
  let padding = 0;
  if (base64.endsWith('==')) {
    padding = 2;
  } else if (base64.endsWith('=')) {
    padding = 1;
  }
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function sanitizeMediaName(name: string): string {
  const withoutPathSeparators = name.replace(/[/\\]/g, '');
  // eslint-disable-next-line no-control-regex
  const withoutControlChars = withoutPathSeparators.replace(/[\u0000-\u001f\u007f]/g, '');
  const trimmed = withoutControlChars.trim();
  return trimmed.slice(0, 120);
}

function isValidBase64(data: string): boolean {
  if (data.length % 4 !== 0) {
    return false;
  }
  return BASE64_PATTERN.test(data);
}

export function validateUpload(input: UploadInput): SanitizedUpload {
  const details: Record<string, unknown> = {};

  if (typeof input.name !== 'string' || input.name.length === 0) {
    details.name = 'required';
  }
  if (typeof input.mimeType !== 'string' || input.mimeType.length === 0) {
    details.mimeType = 'required';
  }
  if (typeof input.data !== 'string' || input.data.length === 0) {
    details.data = 'required';
  } else if (input.data.length > MAX_BASE64_LENGTH) {
    // Reject oversized payloads from their length alone, before scanning megabytes of characters.
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Upload exceeds the maximum allowed size');
  } else if (!isValidBase64(input.data)) {
    details.data = 'invalid base64';
  }

  let sanitizedName = '';
  if (details.name === undefined) {
    sanitizedName = sanitizeMediaName(input.name as string);
    if (sanitizedName.length === 0) {
      details.name = 'required';
    }
  }

  if (Object.keys(details).length > 0) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Validation error', details);
  }

  const mimeType = input.mimeType as string;
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', `Unsupported media type: ${mimeType}`);
  }

  const data = input.data as string;
  const size = decodedSize(data);
  if (size > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Upload exceeds the maximum allowed size');
  }

  return { name: sanitizedName, mimeType: mimeType as AllowedMimeType, data, size };
}
