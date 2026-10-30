import { spawnSync } from 'node:child_process';
import path from 'node:path';

export type DeployMode = 'default' | 'new' | 'push-only';

export interface DeployFlags {
  mode: DeployMode;
  force: boolean;
  description: string;
  dryRun: boolean;
  deploymentId?: string;
}

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type ExecFn = (command: string, args: string[]) => ExecResult;

export interface DeployResult {
  exitCode: number;
  message: string;
}

export interface Deployment {
  deploymentId: string;
  versionNumber?: number;
  description?: string;
}

function defaultDescription(): string {
  return `Deploy ${new Date().toISOString()}`;
}

const USAGE = `Usage: deploy [options]

Options:
  --new                   Create a new deployment instead of redeploying.
  --push-only              Build and push only; skip every deployment call.
  --deployment <id>        Pin the deployment to redeploy (overrides CLASP_DEPLOYMENT_ID).
  --force                  Pass --force to clasp push (overwrites remote manifest).
  --description <text>     Description for the new version/deployment.
  --dry-run                Show what would happen without building, pushing, or deploying.

--new cannot be combined with --deployment or --push-only.`;

export function parseArgs(argv: string[]): DeployFlags {
  const flags: DeployFlags = {
    mode: 'default',
    force: false,
    description: defaultDescription(),
    dryRun: false,
  };

  let sawNew = false;
  let sawPushOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--new':
        flags.mode = 'new';
        sawNew = true;
        break;
      case '--push-only':
        flags.mode = 'push-only';
        sawPushOnly = true;
        break;
      case '--force':
        flags.force = true;
        break;
      case '--dry-run':
        flags.dryRun = true;
        break;
      case '--deployment':
        flags.deploymentId = argv[++i];
        break;
      case '--description':
        flags.description = argv[++i] ?? flags.description;
        break;
      default:
        throw new Error(`${USAGE}\n\nUnknown flag: ${arg}`);
    }
  }

  if (sawNew && flags.deploymentId) {
    throw new Error(`${USAGE}\n\nConflicting flags: --new cannot be combined with --deployment.`);
  }
  if (sawNew && sawPushOnly) {
    throw new Error(`${USAGE}\n\nConflicting flags: --new cannot be combined with --push-only.`);
  }
  return flags;
}

interface SelectOptions {
  explicitId?: string;
  envId?: string;
}

export function selectDeployment(deployments: Deployment[], options: SelectOptions): Deployment {
  const versioned = deployments.filter((d) => d.versionNumber !== undefined);
  const pinnedId = options.explicitId ?? options.envId;

  if (pinnedId) {
    const found = versioned.find((d) => d.deploymentId === pinnedId);
    if (!found) {
      throw new Error(`Deployment not found: ${pinnedId}. Run "clasp list-deployments" to see valid deployment ids.`);
    }
    return found;
  }

  if (versioned.length === 0) {
    throw new Error('No versioned deployment found. Use --new to create one explicitly.');
  }

  return versioned.reduce((highest, current) =>
    (current.versionNumber ?? -1) > (highest.versionNumber ?? -1) ? current : highest,
  );
}

function parseDeploymentList(stdout: string): Deployment[] {
  const match = stdout.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error(`Could not parse "clasp list-deployments" output:\n${stdout}`);
  }
  return JSON.parse(match[0]) as Deployment[];
}

function execUrl(deploymentId: string): string {
  return `https://script.google.com/macros/s/${deploymentId}/exec`;
}

function manifestSkipError(): string {
  return (
    'clasp skipped the push because the remote appsscript.json manifest differs from src/appsscript.json. ' +
    'Copy the remote manifest changes into src/appsscript.json, or re-run with --force to overwrite the remote manifest. ' +
    'No deployment was touched.'
  );
}

export async function runDeploy(
  flags: DeployFlags,
  exec: ExecFn,
  env: Record<string, string | undefined>,
): Promise<DeployResult> {
  if (flags.dryRun) {
    return runDryRun(flags, exec, env);
  }

  const buildResult = exec('pnpm', ['build:clean']);
  if (buildResult.status !== 0) {
    return { exitCode: 1, message: `Build failed:\n${buildResult.stdout}${buildResult.stderr}` };
  }

  const configResult = exec('pnpm', ['clasp:config']);
  if (configResult.status !== 0) {
    return { exitCode: 1, message: `clasp:config failed:\n${configResult.stdout}${configResult.stderr}` };
  }

  const pushArgs = ['push'];
  if (flags.force) pushArgs.push('--force');
  const pushResult = exec('clasp', pushArgs);
  const pushOutput = `${pushResult.stdout}${pushResult.stderr}`;
  if (pushResult.status !== 0 || pushOutput.includes('Skipping push.')) {
    return { exitCode: 1, message: manifestSkipError() };
  }

  if (flags.mode === 'push-only') {
    return { exitCode: 0, message: 'Pushed to /dev. No deployment was created or redeployed (--push-only).' };
  }

  if (flags.mode === 'new') {
    const createResult = exec('clasp', ['create-deployment', '--description', flags.description]);
    if (createResult.status !== 0) {
      return { exitCode: 1, message: `create-deployment failed:\n${createResult.stdout}${createResult.stderr}` };
    }
    return { exitCode: 0, message: `Created a new deployment:\n${createResult.stdout}` };
  }

  const listResult = exec('clasp', ['list-deployments', '--json']);
  if (listResult.status !== 0) {
    return { exitCode: 1, message: `list-deployments failed:\n${listResult.stdout}${listResult.stderr}` };
  }

  let deployments: Deployment[];
  let target: Deployment;
  try {
    deployments = parseDeploymentList(listResult.stdout);
    target = selectDeployment(deployments, { explicitId: flags.deploymentId, envId: env.CLASP_DEPLOYMENT_ID });
  } catch (error) {
    return { exitCode: 1, message: (error as Error).message };
  }

  const redeployResult = exec('clasp', ['redeploy', target.deploymentId, '--description', flags.description]);
  if (redeployResult.status !== 0) {
    return { exitCode: 1, message: `redeploy failed:\n${redeployResult.stdout}${redeployResult.stderr}` };
  }

  return {
    exitCode: 0,
    message: `Redeployed ${target.deploymentId} (was version ${target.versionNumber}).\n${execUrl(target.deploymentId)}`,
  };
}

async function runDryRun(
  flags: DeployFlags,
  exec: ExecFn,
  env: Record<string, string | undefined>,
): Promise<DeployResult> {
  const lines: string[] = ['Dry run — no build, push, or deployment calls were made.'];

  if (flags.mode === 'push-only') {
    lines.push('Would run: pnpm build:clean, pnpm clasp:config, clasp push' + (flags.force ? ' --force' : ''));
    return { exitCode: 0, message: lines.join('\n') };
  }

  lines.push('Would run: pnpm build:clean, pnpm clasp:config, clasp push' + (flags.force ? ' --force' : ''));

  if (flags.mode === 'new') {
    lines.push(`Would create a new deployment with description "${flags.description}".`);
    return { exitCode: 0, message: lines.join('\n') };
  }

  const listResult = exec('clasp', ['list-deployments', '--json']);
  if (listResult.status !== 0) {
    return { exitCode: 1, message: `list-deployments failed:\n${listResult.stdout}${listResult.stderr}` };
  }

  try {
    const deployments = parseDeploymentList(listResult.stdout);
    const target = selectDeployment(deployments, { explicitId: flags.deploymentId, envId: env.CLASP_DEPLOYMENT_ID });
    lines.push(
      `Would redeploy ${target.deploymentId} (currently version ${target.versionNumber}) with description "${flags.description}".`,
      execUrl(target.deploymentId),
    );
  } catch (error) {
    return { exitCode: 1, message: (error as Error).message };
  }

  return { exitCode: 0, message: lines.join('\n') };
}

function nodeExec(command: string, args: string[]): ExecResult {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  const rawArgv = process.argv.slice(2);
  try {
    const flags = parseArgs(rawArgv);
    runDeploy(flags, nodeExec, process.env).then((result) => {
      console.log(result.message);
      process.exitCode = result.exitCode;
    });
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
