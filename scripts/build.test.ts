import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { buildBundle } from './build.ts';

test('buildBundle emits a module-free bundle that exposes top-level functions in GAS', async () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-build-'));

  await buildBundle({ entry: 'src/index.ts', outdir });

  const bundlePath = path.join(outdir, 'bundle.js');
  const code = fs.readFileSync(bundlePath, 'utf8');

  for (const line of code.split('\n')) {
    assert.ok(!line.startsWith('import '), `bundle still has an import line: ${line}`);
    assert.ok(!line.startsWith('export '), `bundle still has an export line: ${line}`);
  }

  const sandbox: Record<string, unknown> = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => null,
    },
    Logger: {
      log: () => {},
    },
  };
  vm.runInNewContext(code, sandbox);
  assert.equal(typeof sandbox.main, 'function');

  assert.ok(fs.existsSync(path.join(outdir, 'appsscript.json')));
});

test('buildBundle copies html views alongside their relative paths', async () => {
  const srcdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-src-'));
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-build-'));

  fs.writeFileSync(path.join(srcdir, 'index.ts'), 'export function main() { return 1; }\n');
  fs.mkdirSync(path.join(srcdir, 'app/views/partials'), { recursive: true });
  fs.writeFileSync(path.join(srcdir, 'app/views/login.html'), '<p>login</p>');
  fs.writeFileSync(path.join(srcdir, 'app/views/partials/header.html'), '<p>header</p>');

  await buildBundle({ entry: path.join(srcdir, 'index.ts'), outdir });

  assert.equal(
    fs.readFileSync(path.join(outdir, 'app/views/login.html'), 'utf8'),
    '<p>login</p>',
  );
  assert.equal(
    fs.readFileSync(path.join(outdir, 'app/views/partials/header.html'), 'utf8'),
    '<p>header</p>',
  );
});
