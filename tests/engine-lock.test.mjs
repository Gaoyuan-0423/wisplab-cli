import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readEngineLock, checkEngineRevision } from '../engine-lock.mjs';
import { setupPlan, installEngines } from '../scripts/setup-engines.mjs';

test('lock checks distinguish clean matching, mismatched, dirty and non-git directories', t => {
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-lock-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(checkEngineRevision(dir, '0'.repeat(40)).verified, false);
  const git = args => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  git(['init']); git(['-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','fixture']);
  const sha = git(['rev-parse','HEAD']);
  assert.equal(checkEngineRevision(dir, sha).verified, true);
  mkdirSync(join(dir,'subdirectory'));
  assert.equal(checkEngineRevision(join(dir,'subdirectory'), sha).verified, false);
  assert.match(checkEngineRevision(join(dir,'subdirectory'), sha).revisionError, /repository root/);
  assert.equal(checkEngineRevision(dir, '0'.repeat(40)).matchesLock, false);
  writeFileSync(join(dir, 'new.txt'), 'edited');
  const dirty = checkEngineRevision(dir, sha); assert.equal(dirty.matchesLock, true); assert.equal(dirty.dirty, true); assert.equal(dirty.verified, false);
});
test('installer plan pins each checkout and refuses existing destinations before executing', t => {
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-setup-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lock = readEngineLock(), plan = setupPlan({ root: join(dir,'engines'), configPath: join(dir,'config.json'), lock });
  for (const engine of Object.values(lock.engines)) assert.ok(plan.steps.some(s => s.args.join(' ') === `checkout --detach ${engine.revision}`));
  let executions = 0;
  assert.throws(() => installEngines({ root: dir, configPath: join(dir,'config.json') }, () => executions++), /destination already exists/);
  writeFileSync(join(dir,'config.json'), 'existing');
  assert.throws(() => installEngines({ root: join(dir,'engines'), configPath: join(dir,'config.json') }, () => executions++), /Config already exists/);
  assert.equal(executions, 0);
});
