import type { Migration } from '../../core/migration.ts';

export const createUsersMigration: Migration = {
  name: '001_create_users',
  up(schema) {
    schema.createSheet('users', ['id', 'email', 'password', 'created_at', 'updated_at', 'deleted_at']);
  },
  down(schema) {
    schema.dropSheet('users');
  },
};
