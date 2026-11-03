import type { Migration } from '../../core/migration.ts';
import { createUsersMigration } from './001_create_users.ts';
import { addUsernameToUsersMigration } from './002_add_username_to_users.ts';
import { addRoleAndDisabledToUsersMigration } from './003_add_role_and_disabled_to_users.ts';
import { createTagsMigration } from './004_create_tags.ts';
import { createPostsMigration } from './005_create_posts.ts';
import { createPostTagsMigration } from './006_create_post_tags.ts';
import { createCommentsMigration } from './007_create_comments.ts';

export const migrations: Migration[] = [
  createUsersMigration,
  addUsernameToUsersMigration,
  addRoleAndDisabledToUsersMigration,
  createTagsMigration,
  createPostsMigration,
  createPostTagsMigration,
  createCommentsMigration,
];
