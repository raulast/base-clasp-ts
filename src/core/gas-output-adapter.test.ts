import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GasOutputAdapter, includeHtml } from './gas-output-adapter.ts';

const globals = globalThis as Record<string, unknown>;

interface FakeTemplate {
  assigned: Record<string, unknown>;
  evaluated: boolean;
}

beforeEach(() => {
  const templates = new Map<string, FakeTemplate>();

  globals.HtmlService = {
    createTemplateFromFile: (name: string) => {
      const template: FakeTemplate = { assigned: {}, evaluated: false };
      templates.set(name, template);
      return new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'evaluate') {
              return () => {
                template.evaluated = true;
                const output = {
                  metaTags: {} as Record<string, string>,
                  getContent: () => `evaluated:${name}`,
                  addMetaTag(tag: string, content: string) {
                    output.metaTags[tag] = content;
                    return output;
                  },
                };
                return output;
              };
            }
            return template.assigned[prop];
          },
          set(_target, prop: string, value: unknown) {
            template.assigned[prop] = value;
            return true;
          },
        },
      );
    },
    createHtmlOutputFromFile: (name: string) => ({
      getContent: () => `content:${name}`,
    }),
  };
  globals.__fakeTemplates = templates;

  globals.ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (text: string) => ({
      text,
      mimeType: undefined as string | undefined,
      setMimeType(mimeType: string) {
        this.mimeType = mimeType;
        return this;
      },
    }),
  };
});

test('renderView assigns every data key onto the template before evaluate', () => {
  const adapter = new GasOutputAdapter();
  const templates = globals.__fakeTemplates as Map<string, FakeTemplate>;

  const result = adapter.renderView('login', { title: 'Sign in', user: 'ada' }) as { getContent: () => string };

  const template = templates.get('login');
  assert.ok(template);
  assert.equal(template?.assigned.title, 'Sign in');
  assert.equal(template?.assigned.user, 'ada');
  assert.equal(template?.evaluated, true);
  assert.equal(result.getContent(), 'evaluated:login');
});

test('json sets the JSON mime type', () => {
  const adapter = new GasOutputAdapter();

  const result = adapter.json({ ok: true }) as { text: string; mimeType: string };

  assert.equal(result.text, JSON.stringify({ ok: true }));
  assert.equal(result.mimeType, 'application/json');
});

test('includeHtml evaluates the partial as a template with the given data', () => {
  const templates = globals.__fakeTemplates as Map<string, FakeTemplate>;

  const content = includeHtml('app/views/partials/header', { appName: 'Demo' });

  assert.equal(content, 'evaluated:app/views/partials/header');
  assert.equal(templates.get('app/views/partials/header')?.assigned.appName, 'Demo');
});

test('renderView adds a responsive viewport meta tag (HtmlService ignores the one in the HTML)', () => {
  const adapter = new GasOutputAdapter();

  const result = adapter.renderView('login', {}) as unknown as { metaTags: Record<string, string> };

  assert.equal(result.metaTags.viewport, 'width=device-width, initial-scale=1');
});
