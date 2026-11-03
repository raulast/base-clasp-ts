import type { SheetAdapter, Row, CellValue } from '../../core/sheet-adapter.ts';
import type { LockAdapter } from '../../core/lock-adapter.ts';
import { noopLock } from '../../core/lock-adapter.ts';
import { Model } from '../../core/model.ts';
import { sameId, belongsToMany } from '../../core/relations.ts';
import { slugify } from '../../core/slug.ts';
import { validationError, conflict, notFound, forbidden, HttpError } from '../../core/api.ts';
import { canCreate, canView, canEdit, type PostUser, type PostRecord } from '../policies/post.policy.ts';
import { TAGS_SHEET } from './tag.model.ts';
import { USERS_SHEET } from './user.model.ts';

export const POSTS_SHEET = 'posts';
export const POST_TAGS_SHEET = 'post_tags';

export const STATUSES = ['draft', 'published', 'archived'] as const;
export type Status = (typeof STATUSES)[number];

export const VISIBILITIES = ['public', 'members', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

const TRANSITIONS: Record<Status, Status[]> = {
  draft: ['published'],
  published: ['archived', 'draft'],
  archived: ['draft'],
};

const MAX_TITLE_LENGTH = 200;
const MAX_EXCERPT_LENGTH = 300;
const MAX_BODY_LENGTH = 50000;
const DEFAULT_PER_PAGE = 10;
const MAX_PER_PAGE = 50;

export interface PostDeps {
  adapter: SheetAdapter;
  lock?: LockAdapter;
  now?: () => Date;
}

export interface PostInput {
  title?: unknown;
  excerpt?: unknown;
  body?: unknown;
  status?: unknown;
  visibility?: unknown;
  slug?: unknown;
  tags?: unknown;
}

export interface PostListFilters {
  page?: unknown;
  perPage?: unknown;
  tag?: unknown;
  author?: unknown;
  status?: unknown;
}

export interface PostAuthor {
  id: CellValue;
  username: CellValue;
}

export interface PostTagRef {
  id: CellValue;
  name: CellValue;
  slug: CellValue;
}

export type PostWithRelations = Row & {
  tags: PostTagRef[];
  author: PostAuthor;
};

export interface PostListResult {
  data: PostWithRelations[];
  meta: { page: number; perPage: number; total: number; pages: number };
}

function postsModel(deps: PostDeps): Model {
  return new Model(POSTS_SHEET, deps.adapter, deps.now ?? (() => new Date()), deps.lock ?? noopLock);
}

function tagsModel(deps: PostDeps): Model {
  return new Model(TAGS_SHEET, deps.adapter, deps.now ?? (() => new Date()), deps.lock ?? noopLock);
}

function usersModel(deps: PostDeps): Model {
  return new Model(USERS_SHEET, deps.adapter, deps.now ?? (() => new Date()), deps.lock ?? noopLock);
}

function postTagsModel(deps: PostDeps): Model {
  return new Model(POST_TAGS_SHEET, deps.adapter, deps.now ?? (() => new Date()), deps.lock ?? noopLock);
}

function postTagsRelation(deps: PostDeps) {
  return belongsToMany(postTagsModel(deps), tagsModel(deps), 'post_id', 'tag_id');
}

function toPostRecord(row: Row): PostRecord {
  return {
    id: row.id,
    author_id: row.author_id,
    status: String(row.status),
    visibility: String(row.visibility),
    deleted_at: row.deleted_at,
  };
}

function validateCommonFields(input: PostInput, details: Record<string, string>): void {
  if (input.excerpt !== undefined) {
    if (typeof input.excerpt !== 'string' || input.excerpt.length > MAX_EXCERPT_LENGTH) {
      details.excerpt = `Excerpt must be at most ${MAX_EXCERPT_LENGTH} characters`;
    }
  }
  if (input.body !== undefined) {
    if (typeof input.body !== 'string' || input.body.length > MAX_BODY_LENGTH) {
      details.body = `Body must be at most ${MAX_BODY_LENGTH} characters`;
    }
  }
  if (input.visibility !== undefined) {
    if (typeof input.visibility !== 'string' || !(VISIBILITIES as readonly string[]).includes(input.visibility)) {
      details.visibility = `Visibility must be one of ${VISIBILITIES.join(', ')}`;
    }
  }
  if (input.status !== undefined) {
    if (typeof input.status !== 'string' || !(STATUSES as readonly string[]).includes(input.status)) {
      details.status = `Status must be one of ${STATUSES.join(', ')}`;
    }
  }
  if (input.slug !== undefined && typeof input.slug !== 'string') {
    details.slug = 'Slug must be a string';
  }
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags) || !input.tags.every((tag) => typeof tag === 'string')) {
      details.tags = 'Tags must be an array of strings';
    }
  }
}

function validateCreateInput(input: PostInput): void {
  const details: Record<string, string> = {};
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > MAX_TITLE_LENGTH) {
    details.title = `Title is required and must be 1-${MAX_TITLE_LENGTH} characters`;
  }
  validateCommonFields(input, details);
  if (Object.keys(details).length > 0) {
    throw validationError(details);
  }
}

function validateUpdateInput(input: PostInput): void {
  const details: Record<string, string> = {};
  if (input.title !== undefined) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title || title.length > MAX_TITLE_LENGTH) {
      details.title = `Title must be 1-${MAX_TITLE_LENGTH} characters`;
    }
  }
  validateCommonFields(input, details);
  if (Object.keys(details).length > 0) {
    throw validationError(details);
  }
}

function resolveTagIds(deps: PostDeps, slugs: string[]): CellValue[] {
  if (slugs.length === 0) return [];
  const rows = tagsModel(deps).all();
  const unknown: string[] = [];
  const ids: CellValue[] = [];
  for (const slug of slugs) {
    const match = rows.find((row) => row.slug === slug);
    if (!match) {
      unknown.push(slug);
    } else {
      ids.push(match.id);
    }
  }
  if (unknown.length > 0) {
    throw validationError({ tags: unknown });
  }
  return ids;
}

function uniqueSlug(deps: PostDeps, base: string, excludeId?: CellValue): string {
  const posts = postsModel(deps);
  const taken = posts.all({ includeDeleted: true }).filter((row) => !sameId(row.id, excludeId));
  if (!taken.some((row) => row.slug === base)) return base;
  let suffix = 2;
  while (taken.some((row) => row.slug === `${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function assertSlugAvailable(deps: PostDeps, slug: string, excludeId?: CellValue): void {
  const posts = postsModel(deps);
  const taken = posts.all({ includeDeleted: true }).some((row) => row.slug === slug && !sameId(row.id, excludeId));
  if (taken) {
    throw conflict('Slug already exists', { slug });
  }
}

interface RelationData {
  users: Row[];
  tags: Row[];
  postTags: Row[];
}

// Reads users, tags and the pivot once, so attaching relations to N posts costs 3 sheet reads, not 3 × N.
function loadRelationData(deps: PostDeps): RelationData {
  return { users: usersModel(deps).all(), tags: tagsModel(deps).all(), postTags: postTagsModel(deps).all() };
}

function withRelations(deps: PostDeps, row: Row, data: RelationData = loadRelationData(deps)): PostWithRelations {
  const tags = data.postTags
    .filter((pivot) => sameId(pivot.post_id, row.id))
    .map((pivot) => data.tags.find((tag) => sameId(tag.id, pivot.tag_id)))
    .filter((tag): tag is Row => tag !== undefined)
    .map((tag) => ({ id: tag.id, name: tag.name, slug: tag.slug }));
  const authorRow = data.users.find((user) => sameId(user.id, row.author_id));
  const author: PostAuthor = authorRow
    ? { id: authorRow.id, username: authorRow.username }
    : { id: row.author_id, username: null };
  return { ...row, tags, author } as PostWithRelations;
}

export function createPost(deps: PostDeps, user: PostUser | null, input: PostInput): PostWithRelations {
  if (!canCreate(user)) {
    throw forbidden('Only authors and admins can create posts');
  }
  validateCreateInput(input);

  const posts = postsModel(deps);
  const title = (input.title as string).trim();
  const tagSlugs = Array.isArray(input.tags) ? (input.tags as string[]) : [];

  return posts.withLock(() => {
    let slug: string;
    if (typeof input.slug === 'string' && input.slug.length > 0) {
      slug = slugify(input.slug);
      assertSlugAvailable(deps, slug);
    } else {
      slug = uniqueSlug(deps, slugify(title));
    }
    const tagIds = resolveTagIds(deps, tagSlugs);

    const row = posts.create({
      author_id: user!.id,
      title,
      slug,
      excerpt: typeof input.excerpt === 'string' ? input.excerpt : '',
      body: typeof input.body === 'string' ? input.body : '',
      status: 'draft',
      visibility: typeof input.visibility === 'string' ? input.visibility : 'public',
      published_at: null,
    });

    if (tagIds.length > 0) {
      postTagsRelation(deps).attach(row.id, tagIds);
    }
    return withRelations(deps, row);
  });
}

function loadViewablePost(deps: PostDeps, user: PostUser | null, id: CellValue): Row {
  const row = postsModel(deps).find(id, { includeDeleted: true });
  if (!row || !canView(user, toPostRecord(row))) {
    throw notFound('Post not found');
  }
  return row;
}

export function updatePost(deps: PostDeps, user: PostUser | null, id: CellValue, input: PostInput): PostWithRelations {
  validateUpdateInput(input);
  const posts = postsModel(deps);

  return posts.withLock(() => {
    const row = loadViewablePost(deps, user, id);
    if (!canEdit(user, toPostRecord(row))) {
      throw forbidden('You cannot edit this post');
    }

    const changes: Partial<Row> = {};

    if (typeof input.title === 'string') {
      changes.title = input.title.trim();
    }
    if (typeof input.excerpt === 'string') {
      changes.excerpt = input.excerpt;
    }
    if (typeof input.body === 'string') {
      changes.body = input.body;
    }
    if (typeof input.visibility === 'string') {
      changes.visibility = input.visibility;
    }

    if (typeof input.slug === 'string' && input.slug.length > 0) {
      const slug = slugify(input.slug);
      assertSlugAvailable(deps, slug, row.id);
      changes.slug = slug;
    }

    if (typeof input.status === 'string' && input.status !== row.status) {
      const currentStatus = row.status as Status;
      const nextStatus = input.status as Status;
      if (!TRANSITIONS[currentStatus]?.includes(nextStatus)) {
        throw new HttpError(422, 'INVALID_TRANSITION', `Cannot transition from ${currentStatus} to ${nextStatus}`);
      }
      changes.status = nextStatus;
      if (nextStatus === 'published' && !row.published_at) {
        changes.published_at = (deps.now ?? (() => new Date()))().getTime();
      }
    }

    const updated = posts.update(row.id, changes);
    if (!updated) {
      throw notFound('Post not found');
    }

    if (Array.isArray(input.tags)) {
      const tagIds = resolveTagIds(deps, input.tags as string[]);
      postTagsRelation(deps).sync(updated.id, tagIds);
    }

    return withRelations(deps, updated);
  });
}

export function deletePost(deps: PostDeps, user: PostUser | null, id: CellValue): void {
  const posts = postsModel(deps);
  posts.withLock(() => {
    const row = loadViewablePost(deps, user, id);
    if (!canEdit(user, toPostRecord(row))) {
      throw forbidden('You cannot delete this post');
    }
    posts.delete(row.id);
  });
}

export function findPostForUser(deps: PostDeps, user: PostUser | null, idOrSlug: string): PostWithRelations {
  const posts = postsModel(deps);
  const row = /^\d+$/.test(idOrSlug)
    ? posts.find(idOrSlug)
    : posts.all().find((candidate) => candidate.slug === idOrSlug) ?? null;

  if (!row || !canView(user, toPostRecord(row))) {
    throw notFound('Post not found');
  }
  return withRelations(deps, row);
}

export function listPostsForUser(deps: PostDeps, user: PostUser | null, filters: PostListFilters): PostListResult {
  const page = filters.page === undefined ? 1 : Number(filters.page);
  const perPage = filters.perPage === undefined ? DEFAULT_PER_PAGE : Number(filters.perPage);
  if (!Number.isInteger(page) || page < 1) {
    throw validationError({ page: 'Page must be a positive integer' });
  }
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > MAX_PER_PAGE) {
    throw validationError({ perPage: `perPage must be between 1 and ${MAX_PER_PAGE}` });
  }

  const posts = postsModel(deps);
  let visible = posts.all().filter((row) => canView(user, toPostRecord(row)));

  if (typeof filters.author === 'string' || typeof filters.author === 'number') {
    visible = visible.filter((row) => sameId(row.author_id, filters.author as CellValue));
  }
  if (typeof filters.status === 'string') {
    visible = visible.filter((row) => row.status === filters.status);
  }
  if (typeof filters.tag === 'string') {
    const tagRow = tagsModel(deps).all().find((row) => row.slug === filters.tag);
    const postIdsWithTag = tagRow
      ? new Set(
          postTagsModel(deps)
            .all({ where: (row) => sameId(row.tag_id, tagRow.id) })
            .map((row) => String(row.post_id)),
        )
      : new Set<string>();
    visible = visible.filter((row) => postIdsWithTag.has(String(row.id)));
  }

  visible.sort((a, b) => {
    const publishedDiff = Number(b.published_at ?? 0) - Number(a.published_at ?? 0);
    if (publishedDiff !== 0) return publishedDiff;
    return Number(b.created_at ?? 0) - Number(a.created_at ?? 0);
  });

  const total = visible.length;
  const start = (page - 1) * perPage;
  const relationData = loadRelationData(deps);
  const data = visible.slice(start, start + perPage).map((row) => withRelations(deps, row, relationData));

  return { data, meta: { page, perPage, total, pages: Math.ceil(total / perPage) } };
}
