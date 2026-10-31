import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { normalizeRuntime } from '../runtime-controls.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(check, ms = 4000) {
  const deadline = Date.now() + ms;
  while (!check()) { if (Date.now() >= deadline) throw new Error('Condition did not become true'); await delay(20); }
}
async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-runtime-'));
  t.after(() => {
    if (existsSync(join(dir, 'pids'))) for (const pid of readFileSync(join(dir, 'pids'), 'utf8').trim().split('\n').map(Number)) {
      try { process.kill(-pid, 'SIGKILL'); } catch {}
    }
    rmSync(dir, { recursive: true, force: true });
  });
  for (const file of ['runtime-controls.mjs', 'runtime-worker.mjs', 'mcp-server.mjs', 'image-review.mjs', 'pcr-groups.mjs', 'pcr-inference.mjs', 'pcr-import.mjs']) copyFileSync(new URL(`../${file}`, import.meta.url), join(dir, file));
  writeFileSync(join(dir, 'package.json'), '{"type":"module","version":"test"}');
  const port = await unusedPort();
  const cfg = { path: join(dir, 'config.json'), allowPaths: [dir], ihc: { devPort: port } };
  writeFileSync(cfg.path, JSON.stringify(cfg));
  writeFileSync(join(dir, 'lib.mjs'), `
    import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';
    import {spawn} from 'node:child_process';
    import {join} from 'node:path';
    let cfg; export function config(path) { if(!cfg) appendFileSync(join(${JSON.stringify(dir)},'workspaces'),process.env.TMPDIR+'\\n'); return cfg ??= JSON.parse(readFileSync(path ?? ${JSON.stringify(cfg.path)})); }
    export function runWb(args) {
      writeFileSync(join(${JSON.stringify(dir)},'wb-started'),'yes');
      if (args.files.some(file=>file.includes('slow'))) while(true) {}
      return {images:args.files.map(file=>({file,value:1}))};
    }
    export async function runIhcEngine({files,onEvent,coloc=false,profile='h_dab'}) {
      const server=spawn(process.execPath,['-e',"require('node:net').createServer().listen("+config().ihc.devPort+",'127.0.0.1',()=>console.log('ready'))"],{detached:true,stdio:['ignore','pipe','ignore']});
      appendFileSync(join(${JSON.stringify(dir)},'pids'),server.pid+'\\n');
      onEvent({kind:'resource',pid:server.pid});
      await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('exit',()=>reject(new Error('port occupied')));});
      try {
        const out=[];
        for(const file of files) {
          onEvent({kind:'file-start',file});
          if(file.includes('slow')) { writeFileSync(join(${JSON.stringify(dir)},'ihc-started'),'yes'); await new Promise(()=>{}); }
          const result={file,value:1};out.push(result);onEvent({kind:'file-result',result});
        }
        if(files.some(file=>file.includes('cleanup'))) await new Promise(()=>{});
        return {files:out,coloc,profile,controlThreshold:null,controlImageName:null};
      } finally {
        const closed=new Promise(resolve=>server.once('exit',resolve));process.kill(-server.pid,'SIGTERM');await closed;
      }
    }
  `);
  const runtime = await import(pathToFileURL(join(dir, 'runtime-controls.mjs')));
  return { dir, cfg, runtime, port };
}

test('runtime deadlines reject non-finite, fractional, nonpositive and unsafe values', () => {
  for (const value of [0, -1, NaN, Infinity, 1.2, 2_147_483_648]) assert.throws(() => normalizeRuntime({ timeoutMs: value }), /integer/);
  assert.equal(normalizeRuntime().timeoutMs, 300000);
});

test('IHC single-image timeout kills detached resources, retains earlier results and continues on the same port', { timeout: 10000 }, async t => {
  const f = await fixture(t), progress = [];
  const result = await f.runtime.runIhcBatch({ files: ['good-a.png', 'slow.png', 'good-c.png'], coloc: false, profile: 'h_dab' }, f.cfg,
    { timeoutMs: 6000, fileTimeoutMs: 150, onProgress: event => progress.push(event.progress) });
  assert.deepEqual(result.files.map(file => file.file), ['good-a.png', 'slow.png', 'good-c.png']);
  assert.equal(result.files[0].value, 1); assert.match(result.files[1].error, /timed out/); assert.equal(result.files[2].value, 1);
  assert.deepEqual(progress, [0, 1, 2, 3]);
  for (const workspace of readFileSync(join(f.dir, 'workspaces'), 'utf8').trim().split('\n')) assert.equal(existsSync(workspace), false, workspace);
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(f.port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
});

test('IHC batch deadline stops remaining files and cancellation allows a subsequent call', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const timed = await f.runtime.runIhcBatch({ files: ['slow.png', 'later.png'] }, f.cfg, { timeoutMs: 400, fileTimeoutMs: 5000 });
  assert.equal(timed.files.length, 2); assert.ok(timed.files.every(file => /Batch timed out/.test(file.error)));
  rmSync(join(f.dir, 'ihc-started'), { force: true });
  const controller = new AbortController();
  const pending = f.runtime.runIhcBatch({ files: ['slow.png', 'later.png'] }, f.cfg, { signal: controller.signal });
  await eventually(() => existsSync(join(f.dir, 'ihc-started')));
  controller.abort();
  const cancelled = await pending;
  assert.equal(cancelled.runtime.cancelled, true); assert.ok(cancelled.files.every(file => /cancelled/.test(file.error)));
  const next = await f.runtime.runIhcBatch({ files: ['good.png'] }, f.cfg);
  assert.equal(next.files[0].value, 1);
});

test('MCP stdio handles ping and cancellation during a CPU-bound worker, then completes the queued call', { timeout: 10000 }, async t => {
  const f = await fixture(t), slow = join(f.dir, 'slow.png'), good = join(f.dir, 'good.png');
  writeFileSync(slow, 'x'); writeFileSync(good, 'x');
  const child = spawn(process.execPath, [join(f.dir, 'mcp-server.mjs'), '--config', f.cfg.path], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  const messages = []; let stderr = '';
  createInterface({ input: child.stdout }).on('line', line => messages.push(JSON.parse(line)));
  child.stderr.on('data', data => { stderr += data; });
  const send = value => child.stdin.write(JSON.stringify(value) + '\n');
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
  const call = (id, file, progressToken) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'wb_quantify', arguments: { files: [file] }, _meta: { ...meta, ...(progressToken ? { progressToken } : {}) } } });
  send(call(1, slow, 'work'));
  await eventually(() => existsSync(join(f.dir, 'wb-started')));
  send(call(2, good));
  send({ jsonrpc: '2.0', id: 3, method: 'ping', params: { _meta: meta } });
  await eventually(() => messages.some(message => message.id === 3));
  assert.equal(messages.some(message => message.id === 2), false);
  send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1, reason: 'test' } });
  child.stdin.end();
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr))); });
  assert.equal(messages.some(message => message.id === 1), false);
  assert.equal(messages.find(message => message.id === 2).result.isError, false);
  const progress = messages.filter(message => message.method === 'notifications/progress');
  assert.equal(progress.length, 1); assert.equal(progress[0].params.progressToken, 'work'); assert.equal(progress[0].params.progress, 0);
  assert.deepEqual(messages.filter(message => message.id !== undefined).map(message => message.id), [3, 2]);
});


test('IHC cleanup deadline retains completed images but marks overall failure', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const result = await f.runtime.runIhcBatch({ files: ['cleanup.png'] }, f.cfg, { timeoutMs: 400, fileTimeoutMs: 2000 });
  assert.equal(result.files[0].value, 1);
  assert.match(result.error, /Batch timed out/);
});
