import { validationError } from './api.ts';

const MAX_SLUG_LENGTH = 80;
const COMBINING_MARKS = /[\u0300-\u036f]/g;

export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-$/, '');

  if (!slug) {
    throw validationError({ slug: 'Could not generate a slug from the given text' });
  }
  return slug;
}
