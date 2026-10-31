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

test('CLI passes explicit QC policy and rejects inconsistent thresholds', (t) => {
  const {dir,cfg}=fixture(t);
  const r=run(['pcr','plate.csv','--config',cfg,'--max-cq','35','--rep-sd','0.5','--qc-mode','exclude','--exclude-rows','2,3'],dir);
  assert.equal(r.status,0,r.stderr);
  const payload=JSON.parse(r.stdout).payload;
  assert.equal(payload.qc.maxCq,35);assert.equal(payload.qc.repSD,0.5);
  assert.equal(payload.qcMode,'exclude');assert.deepEqual(payload.excludeRows,[2,3]);
  for(const args of [['--min-cq','30','--max-cq','20'],['--rep-sd','0'],['--qc-mode','auto'],['--exclude-rows','1,'],['--z-score','NaN']]) {
    assert.notEqual(run(['pcr','plate.csv','--config',cfg,...args],dir).status,0);
  }
  assert.notEqual(run(['pcr','one.csv','two.csv','--config',cfg,'--exclude-rows','2'],dir).status,0);
});

test('ihc-validate compares JSON offline without a config or installed engines', t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wisplab-offline-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sha256 = 'a'.repeat(64);
  const input = join(dir, 'result.json'), reference = join(dir, 'reference.json');
  writeFileSync(input, JSON.stringify({
    files: [{ file: 'image.png', settings: { profile: 'h_dab' }, overall: { totalNuclei: 4 } }],
    provenance: { analysis: 'ihc', status: 'success', runId: 'offline-fixture',
      inputs: [{ file: 'image.png', role: 'input', before: { sha256 }, after: { sha256 }, unchanged: true }],
      checks: { inputsUnchanged: true, engineUnchanged: true, bridgeUnchanged: true } },
  }));
  for (const [expectedCount, tolerance, expectedStatus, exitCode] of [[4, undefined, 'ungraded', 0], [4, 0, 'within-tolerance', 0], [5, 0, 'outside-tolerance', 1]]) {
    writeFileSync(reference, JSON.stringify({ schemaVersion: 'wisplab.ihc-reference/v1', images: [{
      file: 'image.png', sha256, scope: 'whole-image', profile: 'h_dab', sourceKind: 'synthetic',
      method: 'Synthetic offline command fixture', metrics: { totalNuclei: expectedCount },
      ...(tolerance === undefined ? {} : { tolerances: { totalNuclei: tolerance } }),
    }] }));
    const result = run(['ihc-validate', input, reference], dir, { WISPLAB_CONFIG: join(dir, 'nonexistent-config.json') });
    assert.equal(result.status, exitCode, result.stderr);
    assert.equal(result.stderr, '');
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, expectedStatus);
    assert.equal(output.analysisRunId, 'offline-fixture');
    assert.equal(output.documents.length, 2);
    assert.ok(output.documents.every(document => /^[a-f0-9]{64}$/.test(document.sha256)));
  }
});


test('CLI runtime controls keep stdout JSON and progress on stderr', t => {
  const { dir, cfg } = fixture(t);
  const result = run(['wb', 'image.png', '--config', cfg, '--timeout-ms', '600000'], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).runtime.timeoutMs, 600000);
  assert.match(result.stderr, /0\/1.*started/);
  assert.match(result.stderr, /1\/1.*completed/);
  for (const args of [['--timeout-ms', '0'], ['--timeout-ms', 'NaN'], ['--file-timeout-ms', '200']]) {
    const invalid = run(['wb', 'image.png', '--config', cfg, ...args], dir);
    assert.notEqual(invalid.status, 0); assert.equal(invalid.stdout, '');
  }
});
