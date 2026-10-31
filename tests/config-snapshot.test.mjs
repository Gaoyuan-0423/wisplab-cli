import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { config, loadConfig, installConfigSnapshot, runIhc } from '../lib.mjs';
import { runAnalysisJob } from '../runtime-controls.mjs';
import { createMcpHandler } from '../mcp-server.mjs';

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wisplab-config-snapshot-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const engine = join(dir, 'original'), alternate = join(dir, 'alternate');
  for (const path of [engine, alternate]) {
    mkdirSync(join(path, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(path, 'package.json'), '{"version":"fixture"}');
    writeFileSync(join(path, 'node_modules', '.bin', 'tsx'), `#!${process.execPath}\nconsole.log('@@WISPLAB@@'+JSON.stringify({selectedEngine:process.cwd(),payload:JSON.parse(process.argv[3])}));\n`, { mode: 0o755 });
  }
  const git = (...args) => execFileSync('git', ['-C', engine, ...args], { stdio: 'pipe' });
  git('init'); git('add', 'package.json');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  const revision = git('rev-parse', 'HEAD').toString().trim();
  const path = join(dir, 'config.json'), input = join(dir, 'input.png');
  writeFileSync(input, 'fixture');
  writeFileSync(path, JSON.stringify({ repos: { wb: './original', pcr: './original', ihc: './original' }, allowPaths: ['.'], ihc: { devPort: 5289 } }));
  return { dir, engine, alternate, path, input, revision };
}

test('installing a resolved config clones nested state without reading its source or bypassing path loading', t => {
  const f = fixture(t), snapshot = loadConfig(f.path);
  rmSync(f.path);
  installConfigSnapshot(snapshot);
  snapshot.repos.wb = f.alternate; snapshot.ihc.devPort = 5290; snapshot.allowPaths.length = 0;
  assert.equal(config().repos.wb, f.engine); assert.equal(config().ihc.devPort, 5289);
  assert.deepEqual(config().allowPaths, [f.dir]);
  assert.throws(() => config(f.path), /Config not found/);
  assert.throws(() => installConfigSnapshot({ ...snapshot, ihc: { devPort: 0 } }), /Invalid resolved/);
  assert.equal(config().ihc.devPort, 5289);
});

for (const change of ['rewrite', 'delete']) test(`workers and IHC provenance keep the loaded config after source ${change}`, async t => {
  const f = fixture(t), snapshot = config(f.path);
  if (change === 'delete') rmSync(f.path);
  else writeFileSync(f.path, JSON.stringify({ repos: { wb: f.alternate, pcr: f.alternate, ihc: f.alternate }, allowPaths: [], ihc: { devPort: 5290 } }));
  for (const operation of ['wb', 'pcr', 'pcr-preview']) {
    const result = await runAnalysisJob(operation, { files: [f.input] }, snapshot);
    assert.equal(result.selectedEngine, f.engine);
    assert.equal(result.provenance.engine.before.revision, f.revision);
  }
  const result = await runIhc({ files: [f.input] }, snapshot);
  assert.match(result.files[0].error, /Cannot find module 'playwright'/);
  assert.ok(result.files[0].error.includes(join(f.engine, 'package.json')), result.files[0].error);
  assert.equal(result.provenance.engine.before.revision, f.revision);
  assert.equal(result.provenance.parameters.devPort, 5289);
  assert.equal(result.provenance.checks.engineUnchanged, true);
});


test('IHC input identity stays fixed when the caller reuses its file array during initial tracing', async t => {
  const f = fixture(t), snapshot = loadConfig(f.path), files = [f.input];
  const pending = runIhc({ files }, snapshot);
  files[0] = join(f.dir, 'replacement.png');
  files.push(join(f.dir, 'extra.png'));
  const result = await pending;
  assert.deepEqual(result.files.map(file => file.file), ['input.png']);
  assert.deepEqual(result.provenance.inputs.map(input => input.file), ['input.png']);
  assert.equal(result.provenance.checks.inputsUnchanged, true);
});

test('IHC keeps validated channel selections when the caller mutates its options', async t => {
  const f = fixture(t), snapshot = loadConfig(f.path), channels = ['R', 'B'];
  const pending = runIhc({ files: [f.input], coloc: true, channels }, snapshot);
  channels.splice(0, 2, 'invalid', 'invalid');
  const result = await pending;
  assert.deepEqual(result.provenance.parameters.channels, ['R', 'B']);
});

test('a persistent MCP dispatcher keeps WB and PCR engine identity after config replacement and deletion', async t => {
  const f = fixture(t), snapshot = config(f.path);
  const handle = createMcpHandler({ cfg: snapshot });
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
  writeFileSync(f.path, JSON.stringify({ repos: { wb: f.alternate, pcr: f.alternate }, allowPaths: [] }));
  for (const [id, name] of [[1, 'wb_quantify'], [2, 'pcr_analyze']]) {
    if (id === 2) rmSync(f.path);
    const response = await handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { files: [f.input] }, _meta: meta } });
    assert.equal(response.result.isError, false, JSON.stringify(response));
    const result = JSON.parse(response.result.content[0].text);
    assert.equal(result.selectedEngine, f.engine);
    assert.equal(result.provenance.engine.before.revision, f.revision);
  }
});
