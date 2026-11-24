// npm run setup installs the applications from their original per-app lockfiles.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../apps/', import.meta.url));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this installer using npm run setup.');

function run(cwd, args) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const installedBrowsers = new Set();
for (const name of ['wb', 'pathology', 'pcr', 'blotlens']) {
  const cwd = join(root, name);
  console.log('Installing ' + name);
  run(cwd, [npm, 'ci', '--include=dev', '--no-audit', '--no-fund']);
  const manifest = join(cwd, 'node_modules', 'playwright', 'package.json');
  const { version, bin } = JSON.parse(readFileSync(manifest, 'utf8'));
  if (!installedBrowsers.has(version)) {
    run(cwd, [join(dirname(manifest), bin.playwright), 'install', 'chromium']);
    installedBrowsers.add(version);
  }
}
