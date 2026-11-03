import type { Migration } from '../../core/migration.ts';

export const createTagsMigration: Migration = {
  name: '004_create_tags',
  up(schema) {
    schema.createSheet('tags', ['id', 'name', 'slug', 'created_at', 'updated_at', 'deleted_at']);
  },
  down(schema) {
    schema.dropSheet('tags');
  },
};
