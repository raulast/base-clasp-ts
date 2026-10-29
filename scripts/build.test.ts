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

test('buildBundle of the real src/index.ts exposes every GAS global and bundles app/views/index.html', async () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-build-'));

  await buildBundle({ entry: 'src/index.ts', outdir });

  const bundlePath = path.join(outdir, 'bundle.js');
  const code = fs.readFileSync(bundlePath, 'utf8');

  const sandbox: Record<string, unknown> = {
    SpreadsheetApp: { getActiveSpreadsheet: () => null, openById: () => null },
    Logger: { log: () => {} },
    HtmlService: {
      createTemplateFromFile: () => ({ evaluate: () => 'rendered' }),
      createHtmlOutputFromFile: () => ({ getContent: () => '' }),
    },
    ContentService: {
      createTextOutput: () => ({ setMimeType: () => 'json-output' }),
      MimeType: { JSON: 'JSON' },
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => 'test-secret' }),
    },
    Utilities: {
      computeHmacSha256Signature: () => [],
      base64EncodeWebSafe: () => '',
      base64DecodeWebSafe: () => [],
      newBlob: () => ({ getDataAsString: () => '' }),
      getUuid: () => 'uuid',
      Charset: { UTF_8: 'UTF_8' },
    },
  };
  vm.runInNewContext(code, sandbox);

  for (const name of ['doGet', 'doPost', 'api', 'include', 'migrate', 'createUser', 'main']) {
    assert.equal(typeof sandbox[name], 'function', `expected ${name} to be a global function`);
  }

  assert.ok(fs.existsSync(path.join(outdir, 'app/views/index.html')));
});

function adminSandbox(activeEmail: string, adminEmails: string): Record<string, unknown> {
  const sheetWrites: unknown[] = [];
  return {
    SpreadsheetApp: { getActiveSpreadsheet: () => null, openById: () => null },
    Logger: { log: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => activeEmail }) },
    HtmlService: {
      createTemplateFromFile: () => ({ evaluate: () => 'rendered' }),
      createHtmlOutputFromFile: () => ({ getContent: () => '' }),
    },
    ContentService: {
      createTextOutput: () => ({ setMimeType: () => 'json-output' }),
      MimeType: { JSON: 'JSON' },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => (key === 'ADMIN_EMAILS' ? adminEmails : 'test-secret'),
      }),
    },
    Utilities: {
      computeHmacSha256Signature: () => [],
      base64EncodeWebSafe: () => '',
      base64DecodeWebSafe: () => [],
      newBlob: () => ({ getDataAsString: () => '' }),
      getUuid: () => 'uuid',
      Charset: { UTF_8: 'UTF_8' },
    },
    __sheetWrites: sheetWrites,
  };
}

test('real bundle: createUser and migrate reject a non-admin active user without writing', async () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-build-'));
  await buildBundle({ entry: 'src/index.ts', outdir });
  const code = fs.readFileSync(path.join(outdir, 'bundle.js'), 'utf8');

  const sandbox = adminSandbox('eve@example.com', 'ana@example.com');
  vm.runInNewContext(code, sandbox);

  assert.throws(() => (sandbox.createUser as (...args: unknown[]) => unknown)('new@example.com', 'secret'), /Forbidden/);
  assert.throws(() => (sandbox.migrate as (...args: unknown[]) => unknown)(), /Forbidden/);
});

test('real bundle: createUser and migrate reject an empty active user email', async () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-build-'));
  await buildBundle({ entry: 'src/index.ts', outdir });
  const code = fs.readFileSync(path.join(outdir, 'bundle.js'), 'utf8');

  const sandbox = adminSandbox('', 'ana@example.com');
  vm.runInNewContext(code, sandbox);

  assert.throws(() => (sandbox.createUser as (...args: unknown[]) => unknown)('new@example.com', 'secret'), /Forbidden/);
  assert.throws(() => (sandbox.migrate as (...args: unknown[]) => unknown)(), /Forbidden/);
});
