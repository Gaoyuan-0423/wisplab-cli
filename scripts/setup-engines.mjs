#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readEngineLock, checkEngineRevision } from '../engine-lock.mjs';

const expand = path => resolve(path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);
export function setupPlan({ root, configPath, lock = readEngineLock() }) {
  root = expand(root); configPath = expand(configPath);
  const repos = Object.fromEntries(Object.keys(lock.engines).map(name => [name, join(root, name)]));
  const steps = [];
  for (const [name, engine] of Object.entries(lock.engines)) {
    const cwd = repos[name];
    steps.push({ command: 'git', args: ['clone', '--no-checkout', `https://github.com/${engine.repository}.git`, cwd] });
    steps.push({ command: 'git', args: ['checkout', '--detach', engine.revision], cwd });
    steps.push({ command: 'npm', args: ['ci', '--no-audit', '--no-fund'], cwd });
    if (name === 'ihc') steps.push({ command: 'npx', args: ['--no-install', 'playwright', 'install', 'chromium'], cwd });
  }
  return { root, configPath, repos, steps, lock };
}
export function installEngines(options, execute = step => {
  const r = spawnSync(step.command, step.args, { cwd: step.cwd, stdio: 'inherit', shell: false });
  if (r.error || r.status !== 0) throw new Error(`${step.command} failed: ${r.error?.message ?? r.status}`);
}) {
  const plan = setupPlan(options);
  // Reserve a new directory and config; never checkout or overwrite a user's repository.
  if (existsSync(plan.root)) throw new Error(`Engine destination already exists: ${plan.root}; choose a new directory`);
  if (existsSync(plan.configPath)) throw new Error(`Config already exists: ${plan.configPath}`);
  mkdirSync(plan.root, { recursive: false });
  for (const step of plan.steps) execute(step);
  for (const [name, entry] of Object.entries(plan.lock.engines)) {
    const state = checkEngineRevision(plan.repos[name], entry.revision);
    if (!state.verified) throw new Error(`Installed ${name} is not a clean locked revision: ${JSON.stringify(state)}`);
  }
  writeFileSync(plan.configPath, JSON.stringify({ repos: plan.repos, ihc: { devPort: 5173 },
    allowPaths: [join(homedir(), 'Downloads')] }, null, 2) + '\n', { flag: 'wx' });
  return { config: plan.configPath, repos: plan.repos, status: 'installed' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = { root: './wisplab-engines', configPath: './wisplab.verified.config.json' }; let planOnly = false;
    for (let i = 2; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg === '--plan') planOnly = true;
      else if (['--root', '--config'].includes(arg) && process.argv[i + 1] && !process.argv[i + 1].startsWith('--'))
        options[arg === '--root' ? 'root' : 'configPath'] = process.argv[++i];
      else throw new Error('Usage: node scripts/setup-engines.mjs [--root NEW_DIRECTORY] [--config NEW_FILE] [--plan]');
    }
    console.log(JSON.stringify(planOnly ? setupPlan(options) : installEngines(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
