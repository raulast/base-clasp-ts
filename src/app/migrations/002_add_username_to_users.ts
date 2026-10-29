import type { Migration } from '../../core/migration.ts';

export const addUsernameToUsersMigration: Migration = {
  name: '002_add_username_to_users',
  up(schema) {
    schema.addColumn('users', 'username');
  },
  down(schema) {
    schema.dropColumn('users', 'username');
  },
};
