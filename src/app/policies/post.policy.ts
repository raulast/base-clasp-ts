import type { CellValue } from '../../core/sheet-adapter.ts';
import { sameId } from '../../core/relations.ts';

export interface PostUser {
  id: CellValue;
  role: string;
  disabled: boolean;
}

export interface PostRecord {
  id: CellValue;
  author_id: CellValue;
  status: string;
  visibility: string;
  deleted_at: CellValue;
}

function isDeleted(post: PostRecord): boolean {
  return post.deleted_at !== null && post.deleted_at !== undefined && post.deleted_at !== '';
}

function isOwner(user: PostUser | null, post: PostRecord): boolean {
  return user !== null && sameId(user.id, post.author_id);
}

export function canCreate(user: PostUser | null): boolean {
  return user !== null && !user.disabled && (user.role === 'author' || user.role === 'admin');
}

export function canView(user: PostUser | null, post: PostRecord): boolean {
  if (isDeleted(post)) {
    return false;
  }
  if (user?.role === 'admin') {
    return true;
  }
  if (isOwner(user, post)) {
    return true;
  }
  if (post.status !== 'published') {
    return false;
  }
  if (post.visibility === 'public') {
    return true;
  }
  if (post.visibility === 'members') {
    return user !== null;
  }
  return false;
}

function canManage(user: PostUser | null, post: PostRecord): boolean {
  if (isDeleted(post)) {
    return false;
  }
  if (user?.role === 'admin') {
    return true;
  }
  return isOwner(user, post) && (user?.role === 'author' || user?.role === 'admin');
}

export const canEdit = canManage;
export const canDelete = canManage;
