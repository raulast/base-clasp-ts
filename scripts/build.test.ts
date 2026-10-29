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
