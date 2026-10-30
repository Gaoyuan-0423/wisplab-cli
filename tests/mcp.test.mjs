import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createMcpHandler, SUPPORTED_VERSIONS } from '../mcp-server.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
};
const request = (method, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: meta } });
const call = (name, args) => request('tools/call', { name, arguments: args });
const initialize = (protocolVersion = '2025-11-25') => ({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion, capabilities: {}, clientInfo: { name: 'test', version: '1' } },
});
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-mcp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const allowed = join(dir, 'allowed');
  const outside = join(dir, 'allowed-sibling');
  mkdirSync(allowed); mkdirSync(outside);
  const image = join(allowed, 'sample.png');
  const other = join(outside, 'outside.png');
  writeFileSync(image, 'synthetic test fixture'); writeFileSync(other, 'outside');
  const calls = [];
  const engine = {
    runWb: (a) => { calls.push(a); return { files: a.files }; },
    runPcr: (a) => { calls.push(a); return { files: a.files }; },
    runIhc: async (a) => { await new Promise((r) => setTimeout(r, 15)); calls.push(a); return { coloc: a.coloc, value: 42 }; },
    runVerifyPcr: (dir) => { calls.push(dir); return { exitCode: 0, output: 'verified' }; },
  };
  return { dir, allowed, outside, image, other, calls, engine, cfg: { allowPaths: [allowed] } };
}

test('modern discovery advertises explicit versions and modern results', async (t) => {
  const f = fixture(t); const handle = createMcpHandler(f);
  const result = (await handle(request('server/discover'))).result;
  assert.deepEqual(result.supportedVersions, SUPPORTED_VERSIONS);
  assert.equal(result.resultType, 'complete');
  assert.equal(result._meta['io.modelcontextprotocol/serverInfo'].version, JSON.parse(readFileSync(join(root, 'package.json'))).version);
  assert.equal((await handle(request('tools/list'))).result.tools.length, 5);
});

test('legacy negotiation never echoes an unsupported or modern version', async (t) => {
  const handle = createMcpHandler(fixture(t));
  for (const version of ['2026-07-28', '2099-01-01']) {
    assert.equal((await handle(initialize(version))).result.protocolVersion, '2025-11-25');
  }
  assert.equal((await handle(initialize('2024-11-05'))).result.protocolVersion, '2024-11-05');
  const listed = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(listed.result.tools.length, 5);
  assert.equal(listed.result.resultType, undefined);
});

test('modern requests validate metadata independently of previous requests', async (t) => {
  const handle = createMcpHandler(fixture(t));
  assert.equal((await handle(request('ping'))).result.resultType, 'complete');
  assert.equal((await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).error.code, -32600);
  const wrong = request('tools/list');
  wrong.params._meta = { ...meta, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' };
  assert.equal((await handle(wrong)).error.code, -32022);
  const missing = request('tools/list');
  missing.params._meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
  assert.equal((await handle(missing)).error.code, -32602);
});

test('IHC and IF await asynchronous results instead of serializing a Promise', async (t) => {
  const f = fixture(t); const handle = createMcpHandler(f);
  for (const name of ['ihc_quantify', 'if_colocalize']) {
    const response = await handle(call(name, { files: [f.image] }));
    assert.equal(response.result.isError, false);
    assert.deepEqual(JSON.parse(response.result.content[0].text), { coloc: name === 'if_colocalize', value: 42 });
  }
  assert.equal(f.calls.length, 2);
});

test('asynchronous failures become tool errors and the handler remains usable', async (t) => {
  const f = fixture(t);
  f.engine.runIhc = async () => { await Promise.resolve(); throw new Error('browser launch failed'); };
  const handle = createMcpHandler(f);
  const response = await handle(call('ihc_quantify', { files: [f.image] }));
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /browser launch failed/);
  assert.equal((await handle(request('ping'))).result.resultType, 'complete');
});

test('input arrays, numeric options, enum values and unknown flags are validated before execution', async (t) => {
  const f = fixture(t); const handle = createMcpHandler(f);
  for (const args of [{}, { files: [] }, { files: 'wrong' }, { files: [2] },
    { files: [f.image], lanes: 0 }, { files: [f.image], lanes: 2.5 },
    { files: [f.image], bg: 'typo' }, { files: [f.image], unknown: true }]) {
    assert.equal((await handle(call('wb_quantify', args))).result.isError, true);
  }
  assert.equal((await handle(call('pcr_analyze', { files: [f.image], efficiencies: { gene: '92' } }))).result.isError, true);
  assert.equal(f.calls.length, 0);
});

test('allowPaths rejects traversal, sibling prefixes and escaping symlinks', async (t) => {
  const f = fixture(t); const handle = createMcpHandler(f);
  const link = join(f.allowed, 'escape.png'); symlinkSync(f.other, link);
  for (const path of [f.other, join(f.allowed, '..', 'allowed-sibling', 'outside.png'), link]) {
    const response = await handle(call('wb_quantify', { files: [path] }));
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /outside allowPaths/);
  }
  assert.equal(f.calls.length, 0);
});

test('controlTif is checked with the same policy as primary images', async (t) => {
  const f = fixture(t); const handle = createMcpHandler(f);
  const response = await handle(call('ihc_quantify', { files: [f.image], controlTif: f.other }));
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /outside allowPaths/);
  assert.equal(f.calls.length, 0);
});

test('tilde roots expand and allowed symlinks are passed as canonical paths', async (t) => {
  const f = fixture(t);
  const homeDir = mkdtempSync(join(homedir(), '.wisplab-mcp-test-'));
  t.after(() => rmSync(homeDir, { recursive: true, force: true }));
  const image = join(homeDir, 'image.png'); writeFileSync(image, 'fixture');
  const link = join(homeDir, 'link.png'); symlinkSync(image, link);
  f.cfg.allowPaths = ['~/' + homeDir.slice(homedir().length + 1)];
  const response = await createMcpHandler(f)(call('wb_quantify', { files: [link] }));
  assert.equal(response.result.isError, false);
  assert.deepEqual(f.calls[0].files, [realpathSync(image)]);
});

test('pcr_verify checks its default directory and executable script targets', async (t) => {
  const f = fixture(t); const handle = createMcpHandler(f);
  const defaultResult = await handle(call('pcr_verify', {}));
  assert.equal(defaultResult.result.isError, true);
  assert.equal(f.calls.length, 0);
  writeFileSync(join(f.allowed, 'dump_app.ts'), '');
  symlinkSync(f.other, join(f.allowed, 'reference_check.py'));
  const symlinkResult = await handle(call('pcr_verify', { dir: f.allowed }));
  assert.equal(symlinkResult.result.isError, true);
  assert.match(symlinkResult.result.content[0].text, /outside allowPaths/);
  assert.equal(f.calls.length, 0);
});

test('failed verification sets isError even when the subprocess returns a result', async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.allowed, 'dump_app.ts'), ''); writeFileSync(join(f.allowed, 'reference_check.py'), '');
  f.engine.runVerifyPcr = () => ({ exitCode: 1, output: 'verification failed' });
  const response = await createMcpHandler(f)(call('pcr_verify', { dir: f.allowed }));
  assert.equal(response.result.isError, true);
  assert.equal(JSON.parse(response.result.content[0].text).exitCode, 1);
});

test('partial and complete batch failures preserve results and set isError', async (t) => {
  const f = fixture(t);
  for (const entries of [[{ file: 'bad.csv', error: 'invalid table' }],
    [{ file: 'ok.csv', results: [] }, { file: 'bad.csv', error: 'invalid table' }]]) {
    f.engine.runPcr = () => ({ files: entries });
    const response = await createMcpHandler(f)(call('pcr_analyze', { files: [f.image] }));
    assert.equal(response.result.isError, true);
    assert.deepEqual(JSON.parse(response.result.content[0].text), { files: entries });
  }
  f.engine.runWb = () => ({ images: [{ file: 'bad.png', error: 'invalid pixels' }] });
  assert.equal((await createMcpHandler(f)(call('wb_quantify', { files: [f.image] }))).result.isError, true);
});

test('malformed JSON and unknown tools return protocol errors; notifications have no response', async (t) => {
  const handle = createMcpHandler(fixture(t));
  assert.equal((await handle('{')).error.code, -32700);
  assert.equal((await handle([])).error.code, -32600);
  assert.equal((await handle(call('not-a-tool', {}))).error.code, -32602);
  assert.equal((await handle(call('pcr_verify', null))).error.code, -32602);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('stdio --config reaches the shared engine dispatcher instead of environment fallback', (t) => {
  const f = fixture(t);
  const repo = join(f.dir, 'mock-wb'); const bin = join(repo, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'tsx'), '#!/usr/bin/env node\nconsole.log(\'@@WISPLAB@@{"configuredEngine":true}\');\n', { mode: 0o755 });
  const configPath = join(f.dir, 'explicit.json');
  writeFileSync(configPath, JSON.stringify({ repos: { wb: repo }, allowPaths: [f.allowed] }));
  const result = spawnSync(process.execPath, [join(root, 'mcp-server.mjs'), '--config', configPath], {
    cwd: f.dir, encoding: 'utf8', env: { ...process.env, WISPLAB_CONFIG: join(f.dir, 'wrong.json') },
    input: JSON.stringify(call('wb_quantify', { files: [f.image] })) + '\n', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.result.isError, false, response.result.content[0].text);
  const resultData = JSON.parse(response.result.content[0].text);
  assert.equal(resultData.configuredEngine, true);
  assert.equal(resultData.provenance.analysis, "wb");
  assert.equal(resultData.provenance.inputs[0].before.sha256.length, 64);
});

test('stdio drains asynchronous calls at EOF and processes both requests in order', (t) => {
  const f = fixture(t);
  copyFileSync(join(root, 'mcp-server.mjs'), join(f.dir, 'mcp-server.mjs'));
  writeFileSync(join(f.dir, 'package.json'), JSON.stringify({ version: 'test', type: 'module' }));
  writeFileSync(join(f.dir, 'lib.mjs'), `export function config() { return ${JSON.stringify(f.cfg)}; }
    export async function runIhc({ coloc }) {
      await new Promise(resolve => setTimeout(resolve, 30));
      return { completed: true, coloc };
    }
  `);
  const first = call('ihc_quantify', { files: [f.image] });
  const second = { ...call('if_colocalize', { files: [f.image] }), id: 2 };
  const result = spawnSync(process.execPath, [join(f.dir, 'mcp-server.mjs')], {
    cwd: f.dir, encoding: 'utf8', input: [first, second].map(JSON.stringify).join('\n') + '\n', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  const responses = result.stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(responses.map((r) => r.id), [1, 2]);
  assert.deepEqual(responses.map((r) => JSON.parse(r.result.content[0].text)), [
    { completed: true, coloc: false }, { completed: true, coloc: true },
  ]);
});

test('MCP forwards QC options and rejects unknown QC keys', async (t) => {
  const f=fixture(t);const handler=createMcpHandler(f);
  const args={files:[f.image],qc:{maxCq:35,repSD:0.5},qcMode:'exclude',excludeRows:[2]};
  assert.equal((await handler(call('pcr_analyze',args))).result.isError,false);
  assert.deepEqual(f.calls[0].qc,args.qc);assert.equal(f.calls[0].qcMode,'exclude');assert.deepEqual(f.calls[0].excludeRows,[2]);
  assert.equal((await handler(call('pcr_analyze',{files:[f.image],qc:{typo:3}}))).result.isError,true);
});

test('MCP forwards explicit biological design and supports a single reference',async t=>{
 const f=fixture(t),handle=createMcpHandler(f);
 const design={samples:{C1:'C',S1:'S'},controlGroup:'C'};
 const reply=await handle(call('pcr_analyze',{files:[f.image],refGenes:['GAPDH'],biologicalDesign:design}));
 assert.equal(reply.result.isError,false);assert.deepEqual(f.calls[0].refGenes,['GAPDH']);
 assert.deepEqual(f.calls[0].biologicalDesign,design);
 const bad=await handle(call('pcr_analyze',{files:[f.image],biologicalDesign:{...design,paired:true}}));
 assert.ok(bad.error || bad.result.isError);
});
