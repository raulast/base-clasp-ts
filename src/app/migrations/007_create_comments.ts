import type { Migration } from '../../core/migration.ts';

export const createCommentsMigration: Migration = {
  name: '007_create_comments',
  up(schema) {
    schema.createSheet('comments', ['id', 'post_id', 'author_id', 'body', 'created_at', 'updated_at', 'deleted_at']);
  },
  down(schema) {
    schema.dropSheet('comments');
  },
};
