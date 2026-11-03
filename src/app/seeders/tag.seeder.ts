import type { Seeder } from '../../core/seeder.ts';
import { Model } from '../../core/model.ts';
import { slugify } from '../../core/slug.ts';
import { TAGS_SHEET } from '../models/tag.model.ts';

const TAG_NAMES = ['General', 'Tutorial', 'Apps Script', 'TypeScript', 'Google Sheets', 'Announcements'];

export const tagSeeder: Seeder = {
  name: 'tags',
  run(ctx) {
    const model = new Model(TAGS_SHEET, ctx.adapter, ctx.now, ctx.lock);
    let created = 0;
    let existing = 0;
    for (const name of TAG_NAMES) {
      const result = model.firstOrCreate({ slug: slugify(name) }, { name });
      if (result.created) created++;
      else existing++;
    }
    return { created, existing };
  },
};
