import type { SheetAdapter, Row, CellValue } from '../../core/sheet-adapter.ts';
import type { LockAdapter } from '../../core/lock-adapter.ts';
import { noopLock } from '../../core/lock-adapter.ts';
import { Model } from '../../core/model.ts';
import { sameId } from '../../core/relations.ts';
import { HttpError, notFound, forbidden } from '../../core/api.ts';
import { validateUpload, mediaKind, type UploadInput } from '../../core/media-rules.ts';
import type { StorageAdapter } from '../../core/storage-adapter.ts';
import { canEdit, type PostUser, type PostRecord } from '../policies/post.policy.ts';
import { findPostForUser, toPostRecord, type PostDeps } from './post.model.ts';

export const MEDIA_SHEET = 'media';

export interface MediaDeps extends PostDeps {
  storage: StorageAdapter;
  getFolderId: () => string;
}

export interface MediaView {
  id: CellValue;
  post_id: CellValue;
  name: CellValue;
  mime_type: CellValue;
  size: CellValue;
  kind: CellValue;
  created_at: CellValue;
  url?: string;
  downloadUrl?: string;
  embedUrl?: string;
  data?: string;
}

export interface GetMediaOptions {
  download?: boolean;
}

function mediaModel(deps: MediaDeps): Model {
  return new Model(MEDIA_SHEET, deps.adapter, deps.now ?? (() => new Date()), deps.lock ?? noopLock);
}

export function isPostPublic(post: PostRecord): boolean {
  const notDeleted = post.deleted_at === null || post.deleted_at === undefined || post.deleted_at === '';
  return notDeleted && post.status === 'published' && post.visibility === 'public';
}

function toMediaView(deps: MediaDeps, row: Row, post: PostRecord): MediaView {
  const view: MediaView = {
    id: row.id,
    post_id: row.post_id,
    name: row.name,
    mime_type: row.mime_type,
    size: row.size,
    kind: row.kind,
    created_at: row.created_at,
  };
  if (isPostPublic(post)) {
    const links = deps.storage.links(String(row.drive_file_id));
    view.url = links.url;
    view.downloadUrl = links.downloadUrl;
    if (row.kind === 'video') {
      view.embedUrl = links.embedUrl;
    }
  }
  return view;
}

export function uploadMedia(deps: MediaDeps, user: PostUser | null, postIdOrSlug: string, input: UploadInput): MediaView {
  const post = findPostForUser(deps, user, postIdOrSlug);
  const postRecord = toPostRecord(post);
  if (!canEdit(user, postRecord)) {
    throw forbidden('You cannot upload media to this post');
  }
  const sanitized = validateUpload(input);

  const media = mediaModel(deps);
  return media.withLock(() => {
    const folderId = deps.getFolderId();
    const saved = deps.storage.saveFile({
      folderId,
      name: sanitized.name,
      mimeType: sanitized.mimeType,
      base64: sanitized.data,
    });
    const kind = mediaKind(sanitized.mimeType);
    const isPublic = isPostPublic(postRecord);
    const row = media.create({
      post_id: post.id,
      owner_id: user!.id,
      drive_file_id: saved.fileId,
      name: sanitized.name,
      mime_type: sanitized.mimeType,
      size: saved.size,
      kind,
      is_public: isPublic,
    });
    deps.storage.setPublic(saved.fileId, isPublic);
    return toMediaView(deps, row, postRecord);
  });
}

export function listMedia(deps: MediaDeps, user: PostUser | null, postIdOrSlug: string): MediaView[] {
  const post = findPostForUser(deps, user, postIdOrSlug);
  const postRecord = toPostRecord(post);
  const media = mediaModel(deps);
  const rows = media
    .all({ where: (row) => sameId(row.post_id, post.id) })
    .sort((a, b) => Number(a.created_at ?? 0) - Number(b.created_at ?? 0) || Number(a.id) - Number(b.id));
  return rows.map((row) => toMediaView(deps, row, postRecord));
}

export function getMedia(deps: MediaDeps, user: PostUser | null, mediaId: CellValue, options: GetMediaOptions = {}): MediaView {
  const media = mediaModel(deps);
  const row = media.find(mediaId);
  if (!row) {
    throw notFound('Media not found');
  }
  const post = findPostForUser(deps, user, String(row.post_id));
  const postRecord = toPostRecord(post);
  const view = toMediaView(deps, row, postRecord);

  if (!isPostPublic(postRecord) && options.download) {
    if (row.kind === 'video') {
      throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Protected video is not supported');
    }
    const file = deps.storage.readBase64(String(row.drive_file_id));
    view.data = file.data;
  }

  return view;
}

export function deleteMedia(deps: MediaDeps, user: PostUser | null, mediaId: CellValue): { id: CellValue; deleted: true } {
  const media = mediaModel(deps);
  return media.withLock(() => {
    const row = media.find(mediaId);
    if (!row) {
      throw notFound('Media not found');
    }
    const post = findPostForUser(deps, user, String(row.post_id));
    const postRecord = toPostRecord(post);
    if (!canEdit(user, postRecord)) {
      throw forbidden('You cannot delete this media');
    }
    deps.storage.trash(String(row.drive_file_id));
    media.delete(row.id);
    return { id: row.id, deleted: true };
  });
}

export function syncPostMediaSharing(deps: MediaDeps, post: PostRecord): void {
  const media = mediaModel(deps);
  const targetPublic = isPostPublic(post);
  const rows = media.all({ where: (row) => sameId(row.post_id, post.id) });
  for (const row of rows) {
    const currentPublic = row.is_public === true;
    if (currentPublic !== targetPublic) {
      deps.storage.setPublic(String(row.drive_file_id), targetPublic);
      media.update(row.id, { is_public: targetPublic });
    }
  }
}
