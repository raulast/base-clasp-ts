import type { Row, CellValue } from '../../core/sheet-adapter.ts';
import { noopLock } from '../../core/lock-adapter.ts';
import { Model } from '../../core/model.ts';
import { sameId } from '../../core/relations.ts';
import { validationError, notFound, forbidden } from '../../core/api.ts';
import { canComment, canDeleteComment, type CommentRecord } from '../policies/comment.policy.ts';
import type { PostUser } from '../policies/post.policy.ts';
import { findPostForUser, type PostDeps, type PostWithRelations } from './post.model.ts';
import { USERS_SHEET } from './user.model.ts';

export const COMMENTS_SHEET = 'comments';

const MIN_BODY_LENGTH = 1;
const MAX_BODY_LENGTH = 2000;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 50;

export interface CommentInput {
  body?: unknown;
}

export interface CommentListFilters {
  page?: unknown;
  perPage?: unknown;
}

export interface CommentAuthor {
  id: CellValue;
  username: CellValue;
}

export type CommentWithAuthor = Row & { author: CommentAuthor };

export interface CommentListResult {
  data: CommentWithAuthor[];
  meta: { page: number; perPage: number; total: number; pages: number };
}

function commentsModel(deps: PostDeps): Model {
  return new Model(COMMENTS_SHEET, deps.adapter, deps.now ?? (() => new Date()), deps.lock ?? noopLock);
}

function toCommentRecord(row: Row): CommentRecord {
  return { id: row.id, post_id: row.post_id, author_id: row.author_id, deleted_at: row.deleted_at };
}

function toPostRecord(post: PostWithRelations): import('../policies/post.policy.ts').PostRecord {
  return {
    id: post.id,
    author_id: post.author_id,
    status: String(post.status),
    visibility: String(post.visibility),
    deleted_at: post.deleted_at,
  };
}

function withAuthor(row: Row, authorRows: Row[]): CommentWithAuthor {
  const authorRow = authorRows.find((user) => sameId(user.id, row.author_id));
  const author: CommentAuthor = authorRow ? { id: authorRow.id, username: authorRow.username } : { id: row.author_id, username: null };
  return { ...row, author } as CommentWithAuthor;
}

function validateBody(input: CommentInput): string {
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (body.length < MIN_BODY_LENGTH || body.length > MAX_BODY_LENGTH) {
    throw validationError({ body: `Body must be ${MIN_BODY_LENGTH}-${MAX_BODY_LENGTH} characters` });
  }
  return body;
}

export function listComments(
  deps: PostDeps,
  user: PostUser | null,
  postIdOrSlug: string,
  filters: CommentListFilters,
): CommentListResult {
  const post = findPostForUser(deps, user, postIdOrSlug);

  const page = filters.page === undefined ? 1 : Number(filters.page);
  const perPage = filters.perPage === undefined ? DEFAULT_PER_PAGE : Number(filters.perPage);
  if (!Number.isInteger(page) || page < 1) {
    throw validationError({ page: 'Page must be a positive integer' });
  }
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > MAX_PER_PAGE) {
    throw validationError({ perPage: `perPage must be between 1 and ${MAX_PER_PAGE}` });
  }

  const comments = commentsModel(deps);
  const rows = comments
    .all({ where: (row) => sameId(row.post_id, post.id) })
    .sort((a, b) => Number(a.created_at ?? 0) - Number(b.created_at ?? 0) || Number(a.id) - Number(b.id));

  const total = rows.length;
  const start = (page - 1) * perPage;
  const authorRows = new Model(USERS_SHEET, deps.adapter, deps.now ?? (() => new Date()), deps.lock ?? noopLock).all();
  const data = rows.slice(start, start + perPage).map((row) => withAuthor(row, authorRows));

  return { data, meta: { page, perPage, total, pages: Math.ceil(total / perPage) } };
}

export function createComment(
  deps: PostDeps,
  user: PostUser | null,
  postIdOrSlug: string,
  input: CommentInput,
): CommentWithAuthor {
  const post = findPostForUser(deps, user, postIdOrSlug);
  if (!canComment(user, toPostRecord(post))) {
    throw forbidden('Comments are only allowed on published posts');
  }
  const body = validateBody(input);

  const comments = commentsModel(deps);
  return comments.withLock(() => {
    const row = comments.create({ post_id: post.id, author_id: user!.id, body });
    const authorRows = new Model(USERS_SHEET, deps.adapter, deps.now ?? (() => new Date()), deps.lock ?? noopLock).all();
    return withAuthor(row, authorRows);
  });
}

export function deleteComment(deps: PostDeps, user: PostUser | null, commentId: CellValue): { id: CellValue; deleted: true } {
  const comments = commentsModel(deps);
  return comments.withLock(() => {
    const row = comments.find(commentId);
    if (!row) {
      throw notFound('Comment not found');
    }
    const post = findPostForUser(deps, user, String(row.post_id));
    if (!canDeleteComment(user, toCommentRecord(row), toPostRecord(post))) {
      throw forbidden('You cannot delete this comment');
    }
    comments.delete(row.id);
    return { id: row.id, deleted: true };
  });
}
