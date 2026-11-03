import type { Request, Response } from '../../core/router.ts';
import type { SheetAdapter, CellValue } from '../../core/sheet-adapter.ts';
import type { LockAdapter } from '../../core/lock-adapter.ts';
import { ok, created } from '../../core/api.ts';
import {
  createPost,
  updatePost,
  deletePost,
  findPostForUser,
  listPostsForUser,
  type PostDeps,
  type PostInput,
  type PostListFilters,
} from '../models/post.model.ts';
import type { PostUser } from '../policies/post.policy.ts';

export interface PostsControllerDeps {
  adapter: SheetAdapter;
  lock?: LockAdapter;
  now?: () => Date;
}

export interface PostsController {
  list: (request: Request) => Response;
  show: (request: Request) => Response;
  create: (request: Request) => Response;
  update: (request: Request) => Response;
  remove: (request: Request) => Response;
}

function toPostUser(user: Request['user']): PostUser | null {
  if (!user) {
    return null;
  }
  return { id: user.id as CellValue, role: String(user.role), disabled: user.disabled === true };
}

function mergedFilters(request: Request): PostListFilters {
  return { ...request.params, ...request.body };
}

function pickPostInput(body: Record<string, unknown>): PostInput {
  return {
    title: body.title,
    excerpt: body.excerpt,
    body: body.body,
    status: body.status,
    visibility: body.visibility,
    slug: body.slug,
    tags: body.tags,
  };
}

export function createPostsController(deps: PostsControllerDeps): PostsController {
  const postDeps: PostDeps = deps;

  const list = (request: Request): Response => {
    const user = toPostUser(request.user ?? null);
    const { data, meta } = listPostsForUser(postDeps, user, mergedFilters(request));
    return ok(data, meta);
  };

  const show = (request: Request): Response => {
    const user = toPostUser(request.user ?? null);
    const idOrSlug = String(request.pathParams?.idOrSlug ?? '');
    return ok(findPostForUser(postDeps, user, idOrSlug));
  };

  const create = (request: Request): Response => {
    const user = toPostUser(request.user ?? null);
    const post = createPost(postDeps, user, pickPostInput(request.body));
    return created(post);
  };

  const update = (request: Request): Response => {
    const user = toPostUser(request.user ?? null);
    const id = request.pathParams?.id ?? '';
    const post = updatePost(postDeps, user, id, pickPostInput(request.body));
    return ok(post);
  };

  const remove = (request: Request): Response => {
    const user = toPostUser(request.user ?? null);
    const id = request.pathParams?.id ?? '';
    deletePost(postDeps, user, id);
    return ok({ id, deleted: true });
  };

  return { list, show, create, update, remove };
}
