import type { Migration } from '../../core/migration.ts';

export const addRoleAndDisabledToUsersMigration: Migration = {
  name: '003_add_role_and_disabled_to_users',
  up(schema) {
    schema.addColumn('users', 'role');
    schema.addColumn('users', 'disabled');
  },
  down(schema) {
    schema.dropColumn('users', 'role');
    schema.dropColumn('users', 'disabled');
  },
};
