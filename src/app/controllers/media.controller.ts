import type { Request, Response } from '../../core/router.ts';
import type { SheetAdapter, CellValue } from '../../core/sheet-adapter.ts';
import type { LockAdapter } from '../../core/lock-adapter.ts';
import type { StorageAdapter } from '../../core/storage-adapter.ts';
import { ok, created } from '../../core/api.ts';
import { uploadMedia, listMedia, getMedia, deleteMedia, type MediaDeps } from '../models/media.model.ts';
import type { UploadInput } from '../../core/media-rules.ts';
import type { PostUser } from '../policies/post.policy.ts';

export interface MediaControllerDeps {
  adapter: SheetAdapter;
  lock?: LockAdapter;
  now?: () => Date;
  storage: StorageAdapter;
  getFolderId: () => string;
}

export interface MediaController {
  list: (request: Request) => Response;
  upload: (request: Request) => Response;
  show: (request: Request) => Response;
  remove: (request: Request) => Response;
}

function toPostUser(user: Request['user']): PostUser | null {
  if (!user) {
    return null;
  }
  return { id: user.id as CellValue, role: String(user.role), disabled: user.disabled === true };
}

function pickUploadInput(body: Record<string, unknown>): UploadInput {
  return { name: body.name, mimeType: body.mimeType, data: body.data };
}

function downloadFlag(request: Request): boolean {
  const value = request.body.download ?? request.params.download;
  return value === true || value === 'true';
}

export function createMediaController(deps: MediaControllerDeps): MediaController {
  const mediaDeps: MediaDeps = deps;

  const list = (request: Request): Response => {
    const user = toPostUser(request.user ?? null);
    const idOrSlug = String(request.pathParams?.idOrSlug ?? '');
    return ok(listMedia(mediaDeps, user, idOrSlug));
  };

  const upload = (request: Request): Response => {
    const user = toPostUser(request.user ?? null);
    const idOrSlug = String(request.pathParams?.idOrSlug ?? '');
    const media = uploadMedia(mediaDeps, user, idOrSlug, pickUploadInput(request.body));
    return created(media);
  };

  const show = (request: Request): Response => {
    const user = toPostUser(request.user ?? null);
    const id = request.pathParams?.id ?? '';
    const media = getMedia(mediaDeps, user, id, { download: downloadFlag(request) });
    return ok(media);
  };

  const remove = (request: Request): Response => {
    const user = toPostUser(request.user ?? null);
    const id = request.pathParams?.id ?? '';
    return ok(deleteMedia(mediaDeps, user, id));
  };

  return { list, upload, show, remove };
}
