import type { Request, Response } from '../../core/router.ts';
import type { SheetAdapter } from '../../core/sheet-adapter.ts';
import type { LockAdapter } from '../../core/lock-adapter.ts';
import { ok, created, forbidden } from '../../core/api.ts';
import { tagsModel, createTag } from '../models/tag.model.ts';

export interface TagsControllerDeps {
  adapter: SheetAdapter;
  lock?: LockAdapter;
  now?: () => Date;
}

export interface TagsController {
  list: (request: Request) => Response;
  create: (request: Request) => Response;
}

export function createTagsController({ adapter, lock, now }: TagsControllerDeps): TagsController {
  const list = (): Response => {
    const tags = tagsModel(adapter, now, lock).all().map((row) => ({ id: row.id, name: row.name, slug: row.slug }));
    return ok(tags);
  };

  const create = (request: Request): Response => {
    if (!request.user || request.user.role !== 'admin') {
      throw forbidden('Only admins can create tags');
    }
    const name = String(request.body.name ?? '');
    const tag = createTag(adapter, name, now, lock);
    return created({ id: tag.id, name: tag.name, slug: tag.slug });
  };

  return { list, create };
}
