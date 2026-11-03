import type { Migration } from '../../core/migration.ts';

export const createPostTagsMigration: Migration = {
  name: '006_create_post_tags',
  up(schema) {
    schema.createSheet('post_tags', ['id', 'post_id', 'tag_id']);
  },
  down(schema) {
    schema.dropSheet('post_tags');
  },
};
