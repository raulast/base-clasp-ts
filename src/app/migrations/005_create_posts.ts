import type { Migration } from '../../core/migration.ts';

export const createPostsMigration: Migration = {
  name: '005_create_posts',
  up(schema) {
    schema.createSheet('posts', [
      'id',
      'author_id',
      'title',
      'slug',
      'excerpt',
      'body',
      'status',
      'visibility',
      'published_at',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);
  },
  down(schema) {
    schema.dropSheet('posts');
  },
};
