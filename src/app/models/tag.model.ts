import type { SheetAdapter, Row } from '../../core/sheet-adapter.ts';
import type { LockAdapter } from '../../core/lock-adapter.ts';
import { noopLock } from '../../core/lock-adapter.ts';
import { Model } from '../../core/model.ts';
import { slugify } from '../../core/slug.ts';
import { conflict } from '../../core/api.ts';

export const TAGS_SHEET = 'tags';

export function tagsModel(adapter: SheetAdapter, now: () => Date = () => new Date(), lock: LockAdapter = noopLock): Model {
  return new Model(TAGS_SHEET, adapter, now, lock);
}

export function createTag(adapter: SheetAdapter, name: string, now: () => Date = () => new Date(), lock: LockAdapter = noopLock): Row {
  const slug = slugify(name);
  const model = tagsModel(adapter, now, lock);
  return model.withLock(() => {
    if (model.all({ where: (row) => row.slug === slug }).length > 0) {
      throw conflict('Tag slug already exists');
    }
    return model.create({ name, slug });
  });
}
