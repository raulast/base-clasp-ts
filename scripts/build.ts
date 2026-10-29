import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const GLOBAL_NAME = '__GAS_APP__';

export interface BuildOptions {
  entry: string;
  outdir: string;
}

export async function buildBundle(options: BuildOptions): Promise<void> {
  const { entry, outdir } = options;
  fs.mkdirSync(outdir, { recursive: true });

  // esbuild only reports an entry's exports in the metafile for ESM output,
  // so a throwaway in-memory ESM build is used purely to read export names
  // before the real IIFE bundle (which has no `exports` in its metafile).
  const exportsProbe = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    target: 'es2019',
    metafile: true,
    write: false,
  });
  const probeOutput = Object.values(exportsProbe.metafile.outputs)[0];
  const exportNames = probeOutput?.exports ?? [];

  const outfile = path.join(outdir, 'bundle.js');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    globalName: GLOBAL_NAME,
    target: 'es2019',
    minify: false,
    outfile,
    write: true,
  });

  const footer = exportNames
    .map((name) => `function ${name}(...args) { return ${GLOBAL_NAME}.${name}(...args); }`)
    .join('\n');

  if (footer) {
    fs.appendFileSync(outfile, `\n${footer}\n`);
  }

  const entryDir = path.dirname(entry);
  const appsscriptSrc = path.join(entryDir, 'appsscript.json');
  if (fs.existsSync(appsscriptSrc)) {
    fs.copyFileSync(appsscriptSrc, path.join(outdir, 'appsscript.json'));
  }

  copyHtmlFiles(entryDir, entryDir, outdir);
}

function copyHtmlFiles(dir: string, entryDir: string, outdir: string): void {
  for (const entryName of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entryName.name);
    if (entryName.isDirectory()) {
      copyHtmlFiles(fullPath, entryDir, outdir);
      continue;
    }
    if (entryName.isFile() && fullPath.endsWith('.html')) {
      const relativePath = path.relative(entryDir, fullPath);
      const destPath = path.join(outdir, relativePath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(fullPath, destPath);
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  const outdir = path.resolve('dist');
  fs.rmSync(outdir, { recursive: true, force: true });
  buildBundle({ entry: 'src/index.ts', outdir }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
