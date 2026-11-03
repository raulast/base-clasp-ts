import type { Migration } from '../../core/migration.ts';

export const createMediaMigration: Migration = {
  name: '008_create_media',
  up(schema) {
    schema.createSheet('media', [
      'id',
      'post_id',
      'owner_id',
      'drive_file_id',
      'name',
      'mime_type',
      'size',
      'kind',
      'is_public',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);
  },
  down(schema) {
    schema.dropSheet('media');
  },
};
