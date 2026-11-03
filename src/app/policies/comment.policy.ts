import type { CellValue } from '../../core/sheet-adapter.ts';
import { sameId } from '../../core/relations.ts';
import { canView, type PostUser, type PostRecord } from './post.policy.ts';

export interface CommentRecord {
  id: CellValue;
  post_id: CellValue;
  author_id: CellValue;
  deleted_at: CellValue;
}

export function canComment(user: PostUser | null, post: PostRecord): boolean {
  if (!user || user.disabled) {
    return false;
  }
  return canView(user, post) && post.status === 'published';
}

export function canDeleteComment(user: PostUser | null, comment: CommentRecord, post: PostRecord): boolean {
  if (!user) {
    return false;
  }
  if (user.role === 'admin') {
    return true;
  }
  return sameId(user.id, comment.author_id) || sameId(user.id, post.author_id);
}
