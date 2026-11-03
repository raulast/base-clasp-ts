import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySheetAdapter } from '../../core/testing/in-memory-sheet-adapter.ts';
import { HttpError } from '../../core/api.ts';
import { createTag, tagsModel } from './tag.model.ts';

const NOW = () => new Date(1700000000000);

function setup() {
  const adapter = new InMemorySheetAdapter();
  adapter.seed('tags', ['id', 'name', 'slug', 'created_at', 'updated_at', 'deleted_at']);
  return adapter;
}

test('createTag generates a slug from the name', () => {
  const adapter = setup();

  const tag = createTag(adapter, 'General Topics', NOW);

  assert.equal(tag.name, 'General Topics');
  assert.equal(tag.slug, 'general-topics');
});

test('createTag rejects a duplicate slug with 409', () => {
  const adapter = setup();
  createTag(adapter, 'Tutorial', NOW);

  assert.throws(() => createTag(adapter, 'Tutorial', NOW), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 409);
    assert.equal(error.code, 'CONFLICT');
    return true;
  });
});

test('tagsModel exposes the tags sheet', () => {
  const adapter = setup();
  createTag(adapter, 'Apps Script', NOW);

  const model = tagsModel(adapter, NOW);

  assert.equal(model.all().length, 1);
});
