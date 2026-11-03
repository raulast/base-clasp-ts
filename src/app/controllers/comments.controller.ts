import type { Request, Response } from '../../core/router.ts';
import type { SheetAdapter, CellValue } from '../../core/sheet-adapter.ts';
import type { LockAdapter } from '../../core/lock-adapter.ts';
import { ok, created } from '../../core/api.ts';
import { listComments, createComment, deleteComment } from '../models/comment.model.ts';
import type { PostDeps } from '../models/post.model.ts';
import type { PostUser } from '../policies/post.policy.ts';

export interface CommentsControllerDeps {
  adapter: SheetAdapter;
  lock?: LockAdapter;
  now?: () => Date;
}

export interface CommentsController {
  list: (request: Request) => Response;
  create: (request: Request) => Response;
  remove: (request: Request) => Response;
}

function toPostUser(user: Request['user']): PostUser | null {
  if (!user) {
    return null;
  }
  return { id: user.id as CellValue, role: String(user.role), disabled: user.disabled === true };
}

export function createCommentsController(deps: CommentsControllerDeps): CommentsController {
  const postDeps: PostDeps = deps;

  const list = (request: Request): Response => {
    const user = toPostUser(request.user ?? null);
    const idOrSlug = String(request.pathParams?.idOrSlug ?? '');
    const { data, meta } = listComments(postDeps, user, idOrSlug, { ...request.params, ...request.body });
    return ok(data, meta);
  };

  const create = (request: Request): Response => {
    const user = toPostUser(request.user ?? null);
    const idOrSlug = String(request.pathParams?.idOrSlug ?? '');
    const comment = createComment(postDeps, user, idOrSlug, { body: request.body.body });
    return created(comment);
  };

  const remove = (request: Request): Response => {
    const user = toPostUser(request.user ?? null);
    const id = request.pathParams?.id ?? '';
    const result = deleteComment(postDeps, user, id);
    return ok(result);
  };

  return { list, create, remove };
}
