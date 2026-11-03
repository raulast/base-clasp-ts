import type { Migration } from '../../core/migration.ts';
import { createUsersMigration } from './001_create_users.ts';
import { addUsernameToUsersMigration } from './002_add_username_to_users.ts';
import { addRoleAndDisabledToUsersMigration } from './003_add_role_and_disabled_to_users.ts';

export const migrations: Migration[] = [createUsersMigration, addUsernameToUsersMigration, addRoleAndDisabledToUsersMigration];
