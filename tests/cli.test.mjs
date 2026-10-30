import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig, config, runWb, runPcr, runIhc } from '../lib.mjs';

const cli = resolve('cli.mjs');
function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wisplab-test-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const engine = join(dir, 'engine');
  mkdirSync(join(engine, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(engine, 'node_modules', '.bin', 'tsx'), `#!${process.execPath}\nconsole.log('@@WISPLAB@@' + JSON.stringify({ selectedEngine: process.cwd(), payload: JSON.parse(process.argv[3]) }));\n`, { mode: 0o755 });
  const cfg = join(dir, 'config.json');
  writeFileSync(cfg, JSON.stringify({ repos: { wb: './engine', pcr: './engine' }, allowPaths: ['./data', '~/Downloads'] }));
  return { dir, engine, cfg };
}
function run(args, cwd, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, WISPLAB_CONFIG: '', ...env } });
}

test('help and version work with no config or installed engines', (t) => {
  const { dir } = fixture(t);
  for (const flag of ['--help', '--version']) {
    const r = run([flag], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.trim());
  }
});
test('explicit config selects the executing engine and resolves relative paths', (t) => {
  const { dir, engine, cfg } = fixture(t);
  const r = run(['wb', 'input.png', '--config', cfg, '--control', '2', '--lanes', '3'], dir);
  assert.equal(r.status, 0, r.stderr);
  const output = JSON.parse(r.stdout);
  assert.equal(output.selectedEngine, engine);
  assert.equal(output.payload.controlLane, 2);
  assert.equal(output.payload.files[0], join(dir, 'input.png'));
  assert.equal(loadConfig(cfg).allowPaths[0], join(dir, 'data'));
});
test('explicit missing config never silently falls back', (t) => {
  const { dir, cfg } = fixture(t);
  const r = run(['doctor', '--config', join(dir, 'missing.json')], dir, { WISPLAB_CONFIG: cfg });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Config not found/);
});
test('environment config reaches shared dispatch', (t) => {
  const { dir, engine, cfg } = fixture(t);
  const r = run(['pcr', 'plate.csv', '--ref', 'GAPDH, ACTB', '--eff', 'T=92'], dir, { WISPLAB_CONFIG: cfg });
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.selectedEngine, engine);
  assert.deepEqual(result.payload.refGenes, ['GAPDH', 'ACTB']);
  assert.equal(result.payload.efficiencies.T, 92);
});
test('invalid CLI flags and values fail before running an engine', (t) => {
  const { dir, cfg } = fixture(t);
  for (const args of [
    ['wb', 'image.png', '--lanes'], ['wb', 'image.png', '--bg', 'locla'],
    ['wb', 'image.png', '--control', '0'], ['wb', 'image.png', '--lanes', '2', '--control', '3'],
    ['pcr', 'plate.csv', '--eff', 'T='], ['pcr', 'plate.csv', '--eff', 'T=NaN'],
    ['wb', 'image.png', '--ref', 'GAPDH'], ['wb', 'image.png', '--singal', 'dark'],
  ]) {
    const r = run(['--config', cfg, ...args], dir);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.equal(r.stdout, '');
  }
});
test('shared API rejects malformed files, efficiency and unsupported calibration', async (t) => {
  const { cfg } = fixture(t);
  config(cfg);
  assert.throws(() => runWb({ files: [] }), /At least one/);
  assert.throws(() => runPcr({ files: ['x'], efficiencies: { T: NaN } }), /percentages/);
  await assert.rejects(runIhc({ files: ['x'], profile: 'masson', controlTif: 'y' }), /H-DAB only/);
});

test('per-file analysis errors preserve JSON and set a failing exit code', (t) => {
  const { dir, engine, cfg } = fixture(t);
  writeFileSync(join(engine, 'node_modules', '.bin', 'tsx'), `#!${process.execPath}\nconsole.log('@@WISPLAB@@' + JSON.stringify({ files: [{ file: 'bad.csv', error: 'No analyzable rows' }] }));\n`, { mode: 0o755 });
  const result = run(['pcr', 'bad.csv', '--config', cfg], dir);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).files[0].error, 'No analyzable rows');
});
