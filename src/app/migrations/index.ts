import type { Migration } from '../../core/migration.ts';
import { createUsersMigration } from './001_create_users.ts';

export const migrations: Migration[] = [createUsersMigration];
