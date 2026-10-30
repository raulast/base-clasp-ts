import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs,
  selectDeployment,
  runDeploy,
  type ExecFn,
  type ExecResult,
} from './deploy.ts';

const HEAD_ONLY = JSON.stringify([{ deploymentId: 'HEAD' }]);

function listOutput(deployments: Array<{ deploymentId: string; versionNumber?: number; description?: string }>): string {
  return JSON.stringify(deployments);
}

function ok(stdout = ''): ExecResult {
  return { status: 0, stdout, stderr: '' };
}

function recordingExec(responses: Record<string, (args: string[]) => ExecResult>): {
  exec: ExecFn;
  calls: Array<{ command: string; args: string[] }>;
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  const exec: ExecFn = (command, args) => {
    calls.push({ command, args });
    const key = args[0] ?? command;
    const handler = responses[key];
    if (handler) return handler(args);
    return ok();
  };
  return { exec, calls };
}

// --- parseArgs ---

test('parseArgs: default flags', () => {
  const flags = parseArgs([]);
  assert.equal(flags.mode, 'default');
  assert.equal(flags.force, false);
  assert.equal(flags.dryRun, false);
  assert.ok(flags.description.length > 0);
});

test('parseArgs: --new sets mode to new', () => {
  const flags = parseArgs(['--new']);
  assert.equal(flags.mode, 'new');
});

test('parseArgs: --push-only sets mode to push-only', () => {
  const flags = parseArgs(['--push-only']);
  assert.equal(flags.mode, 'push-only');
});

test('parseArgs: --deployment <id> sets pinned deployment', () => {
  const flags = parseArgs(['--deployment', 'abc123']);
  assert.equal(flags.deploymentId, 'abc123');
});

test('parseArgs: --force sets force flag', () => {
  const flags = parseArgs(['--force']);
  assert.equal(flags.force, true);
});

test('parseArgs: --description passes through', () => {
  const flags = parseArgs(['--description', 'my change']);
  assert.equal(flags.description, 'my change');
});

test('parseArgs: --dry-run sets dryRun', () => {
  const flags = parseArgs(['--dry-run']);
  assert.equal(flags.dryRun, true);
});

test('parseArgs: unknown flag throws usage error', () => {
  assert.throws(() => parseArgs(['--bogus']), /usage|unknown/i);
});

test('parseArgs: --new with --deployment conflicts', () => {
  assert.throws(() => parseArgs(['--new', '--deployment', 'abc']), /usage|conflict/i);
});

test('parseArgs: --new with --push-only conflicts', () => {
  assert.throws(() => parseArgs(['--new', '--push-only']), /usage|conflict/i);
});

// --- selectDeployment ---

test('selectDeployment: picks highest versionNumber, skips HEAD', () => {
  const deployments = [
    { deploymentId: 'HEAD' },
    { deploymentId: 'v5', versionNumber: 5 },
    { deploymentId: 'v2', versionNumber: 2 },
  ];
  const result = selectDeployment(deployments, {});
  assert.equal(result.deploymentId, 'v5');
});

test('selectDeployment: explicit deploymentId wins over env', () => {
  const deployments = [
    { deploymentId: 'HEAD' },
    { deploymentId: 'v5', versionNumber: 5 },
    { deploymentId: 'pinned', versionNumber: 2 },
  ];
  const result = selectDeployment(deployments, { explicitId: 'pinned', envId: 'v5' });
  assert.equal(result.deploymentId, 'pinned');
});

test('selectDeployment: env wins over highest version', () => {
  const deployments = [
    { deploymentId: 'HEAD' },
    { deploymentId: 'v5', versionNumber: 5 },
    { deploymentId: 'fromenv', versionNumber: 2 },
  ];
  const result = selectDeployment(deployments, { envId: 'fromenv' });
  assert.equal(result.deploymentId, 'fromenv');
});

test('selectDeployment: pinned id not present among versioned deployments errors', () => {
  const deployments = [
    { deploymentId: 'HEAD' },
    { deploymentId: 'v5', versionNumber: 5 },
  ];
  assert.throws(() => selectDeployment(deployments, { explicitId: 'missing' }), /not found/i);
});

test('selectDeployment: no versioned deployment errors and suggests --new', () => {
  const deployments = [{ deploymentId: 'HEAD' }];
  assert.throws(() => selectDeployment(deployments, {}), /--new/);
});

// --- runDeploy flow ---

test('runDeploy default flow: build, config, push, list, redeploy highest version', async () => {
  const { exec, calls } = recordingExec({
    'list-deployments': () =>
      ok(listOutput([
        { deploymentId: 'HEAD' },
        { deploymentId: 'v5', versionNumber: 5 },
        { deploymentId: 'v2', versionNumber: 2 },
      ])),
  });

  const result = await runDeploy({ mode: 'default', force: false, description: 'desc', dryRun: false }, exec, {});

  assert.equal(result.exitCode, 0);
  const commands = calls.map((c) => [c.command, ...c.args].join(' '));
  assert.ok(commands.some((c) => c.includes('pnpm') && c.includes('build:clean')));
  assert.ok(commands.some((c) => c.includes('clasp:config')));
  assert.ok(commands.some((c) => c.startsWith('clasp push')));
  assert.ok(commands.some((c) => c.includes('list-deployments')));
  assert.ok(commands.some((c) => c.includes('redeploy') && c.includes('v5')));
  assert.ok(!commands.some((c) => c.includes('create-deployment')));
  assert.ok(result.message.includes('https://script.google.com/macros/s/v5/exec'));
});

test('runDeploy: Skipping push. output blocks list/redeploy with manifest error', async () => {
  const { exec, calls } = recordingExec({
    push: () => ok('Pushing files...\nSkipping push.\n'),
  });

  const result = await runDeploy({ mode: 'default', force: false, description: 'desc', dryRun: false }, exec, {});

  assert.notEqual(result.exitCode, 0);
  assert.match(result.message, /src\/appsscript\.json/);
  assert.match(result.message, /--force/);
  assert.ok(!calls.some((c) => c.args.includes('list-deployments')));
  assert.ok(!calls.some((c) => c.args.includes('redeploy')));
});

test('runDeploy: non-zero push status blocks list/redeploy with manifest error', async () => {
  const { exec, calls } = recordingExec({
    push: () => ({ status: 1, stdout: '', stderr: 'boom' }),
  });

  const result = await runDeploy({ mode: 'default', force: false, description: 'desc', dryRun: false }, exec, {});

  assert.notEqual(result.exitCode, 0);
  assert.match(result.message, /src\/appsscript\.json/);
  assert.match(result.message, /--force/);
  assert.ok(!calls.some((c) => c.args.includes('list-deployments')));
});

test('runDeploy: --deployment wins over CLASP_DEPLOYMENT_ID env', async () => {
  const { exec, calls } = recordingExec({
    'list-deployments': () =>
      ok(listOutput([
        { deploymentId: 'HEAD' },
        { deploymentId: 'pinned', versionNumber: 1 },
        { deploymentId: 'fromenv', versionNumber: 2 },
      ])),
  });

  const result = await runDeploy(
    { mode: 'default', force: false, description: 'desc', dryRun: false, deploymentId: 'pinned' },
    exec,
    { CLASP_DEPLOYMENT_ID: 'fromenv' },
  );

  assert.equal(result.exitCode, 0);
  const redeployCall = calls.find((c) => c.args.includes('redeploy'));
  assert.ok(redeployCall?.args.includes('pinned'));
});

test('runDeploy: CLASP_DEPLOYMENT_ID env wins over highest version', async () => {
  const { exec, calls } = recordingExec({
    'list-deployments': () =>
      ok(listOutput([
        { deploymentId: 'HEAD' },
        { deploymentId: 'fromenv', versionNumber: 2 },
        { deploymentId: 'v5', versionNumber: 5 },
      ])),
  });

  const result = await runDeploy({ mode: 'default', force: false, description: 'desc', dryRun: false }, exec, {
    CLASP_DEPLOYMENT_ID: 'fromenv',
  });

  assert.equal(result.exitCode, 0);
  const redeployCall = calls.find((c) => c.args.includes('redeploy'));
  assert.ok(redeployCall?.args.includes('fromenv'));
});

test('runDeploy: pinned id not among versioned deployments errors without redeploy', async () => {
  const { exec, calls } = recordingExec({
    'list-deployments': () => ok(listOutput([{ deploymentId: 'HEAD' }, { deploymentId: 'v5', versionNumber: 5 }])),
  });

  const result = await runDeploy(
    { mode: 'default', force: false, description: 'desc', dryRun: false, deploymentId: 'nope' },
    exec,
    {},
  );

  assert.notEqual(result.exitCode, 0);
  assert.ok(!calls.some((c) => c.args.includes('redeploy')));
});

test('runDeploy: no versioned deployment errors suggesting --new, never creates one', async () => {
  const { exec, calls } = recordingExec({
    'list-deployments': () => ok(HEAD_ONLY),
  });

  const result = await runDeploy({ mode: 'default', force: false, description: 'desc', dryRun: false }, exec, {});

  assert.notEqual(result.exitCode, 0);
  assert.match(result.message, /--new/);
  assert.ok(!calls.some((c) => c.args.includes('create-deployment')));
});

test('runDeploy: --new calls create-deployment and never redeploy', async () => {
  const { exec, calls } = recordingExec({
    'create-deployment': () => ok('Created deployment abc\n'),
  });

  const result = await runDeploy({ mode: 'new', force: false, description: 'desc', dryRun: false }, exec, {});

  assert.equal(result.exitCode, 0);
  assert.ok(calls.some((c) => c.args.includes('create-deployment')));
  assert.ok(!calls.some((c) => c.args.includes('redeploy')));
});

test('runDeploy: --push-only makes no deployment calls', async () => {
  const { exec, calls } = recordingExec({});

  const result = await runDeploy({ mode: 'push-only', force: false, description: 'desc', dryRun: false }, exec, {});

  assert.equal(result.exitCode, 0);
  assert.ok(!calls.some((c) => c.args.includes('redeploy')));
  assert.ok(!calls.some((c) => c.args.includes('create-deployment')));
  assert.ok(!calls.some((c) => c.args.includes('list-deployments')));
});

test('runDeploy: --force adds --force to push', async () => {
  const { exec, calls } = recordingExec({
    'list-deployments': () => ok(listOutput([{ deploymentId: 'HEAD' }, { deploymentId: 'v5', versionNumber: 5 }])),
  });

  await runDeploy({ mode: 'default', force: true, description: 'desc', dryRun: false }, exec, {});

  const pushCall = calls.find((c) => c.args[0] === 'push');
  assert.ok(pushCall?.args.includes('--force'));
});

test('runDeploy: --description is passed through to redeploy', async () => {
  const { exec, calls } = recordingExec({
    'list-deployments': () => ok(listOutput([{ deploymentId: 'HEAD' }, { deploymentId: 'v5', versionNumber: 5 }])),
  });

  await runDeploy({ mode: 'default', force: false, description: 'custom description', dryRun: false }, exec, {});

  const redeployCall = calls.find((c) => c.args.includes('redeploy'));
  assert.ok(redeployCall?.args.includes('custom description'));
});

test('runDeploy: --dry-run performs no build/push/redeploy/create calls, lists are allowed', async () => {
  const { exec, calls } = recordingExec({
    'list-deployments': () => ok(listOutput([{ deploymentId: 'HEAD' }, { deploymentId: 'v5', versionNumber: 5 }])),
  });

  const result = await runDeploy({ mode: 'default', force: false, description: 'desc', dryRun: true }, exec, {});

  assert.equal(result.exitCode, 0);
  assert.ok(!calls.some((c) => c.command === 'pnpm' && c.args.includes('build:clean')));
  assert.ok(!calls.some((c) => c.args[0] === 'push'));
  assert.ok(!calls.some((c) => c.args.includes('redeploy')));
  assert.ok(!calls.some((c) => c.args.includes('create-deployment')));
  assert.ok(calls.some((c) => c.args.includes('list-deployments')));
  assert.match(result.message, /v5/);
});

test('runDeploy: list output with non-JSON noise lines still parses', async () => {
  const noisy = `Warning: something\n${listOutput([
    { deploymentId: 'HEAD' },
    { deploymentId: 'v5', versionNumber: 5 },
  ])}\nDone.\n`;
  const { exec, calls } = recordingExec({
    'list-deployments': () => ok(noisy),
  });

  const result = await runDeploy({ mode: 'default', force: false, description: 'desc', dryRun: false }, exec, {});

  assert.equal(result.exitCode, 0);
  assert.ok(calls.some((c) => c.args.includes('redeploy') && c.args.includes('v5')));
});

test('runDeploy: success prints the /exec URL', async () => {
  const { exec } = recordingExec({
    'list-deployments': () => ok(listOutput([{ deploymentId: 'HEAD' }, { deploymentId: 'v5', versionNumber: 5 }])),
  });

  const result = await runDeploy({ mode: 'default', force: false, description: 'desc', dryRun: false }, exec, {});

  assert.match(result.message, /https:\/\/script\.google\.com\/macros\/s\/v5\/exec/);
});
