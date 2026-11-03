import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const VIEWS_DIR = path.resolve(import.meta.dirname, 'views');

function walkHtmlFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkHtmlFiles(fullPath));
    } else if (entry.isFile() && fullPath.endsWith('.html')) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractScriptBlocks(html: string): string[] {
  const blocks: string[] = [];
  const pattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

const htmlFiles = walkHtmlFiles(VIEWS_DIR);

test('every view file exists and the suite found at least one', () => {
  assert.ok(htmlFiles.length > 0);
});

for (const file of htmlFiles) {
  const relative = path.relative(VIEWS_DIR, file);
  const content = fs.readFileSync(file, 'utf8');

  test(`${relative} contains no innerHTML`, () => {
    assert.ok(!content.includes('innerHTML'), `${relative} uses innerHTML`);
  });

  test(`${relative} only uses <?!= for include(...)`, () => {
    const pattern = /<\?!=\s*/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const after = content.slice(match.index + match[0].length);
      assert.ok(after.startsWith('include('), `${relative} has a <?!= not immediately followed by include(`);
    }
  });

  test(`${relative} never puts a token in an href/URL`, () => {
    const hrefPattern = /(href|src)\s*=\s*["'][^"']*\?[^"']*/gi;
    let match: RegExpExecArray | null;
    while ((match = hrefPattern.exec(content)) !== null) {
      assert.ok(!/[?&]token=/.test(match[0]), `${relative} has a token in a URL attribute: ${match[0]}`);
    }
    assert.ok(!/[?&]token=/.test(content), `${relative} has a ?token=/&token= fragment`);
  });

  const scripts = extractScriptBlocks(content);
  for (let index = 0; index < scripts.length; index += 1) {
    test(`${relative} script block ${index} is syntactically valid`, () => {
      // Scriptlets (<?= ... ?>) are evaluated server-side before the script reaches the browser,
      // so they are replaced with a harmless literal before the syntax check.
      const code = scripts[index].replace(/<\?=[^?]*\?>/g, '""');
      assert.doesNotThrow(() => new Function(code));
    });
  }
}
