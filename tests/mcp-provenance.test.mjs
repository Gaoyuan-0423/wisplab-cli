import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, delimiter } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(check, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!check()) { if (Date.now() >= deadline) throw new Error('Condition did not become true'); await delay(10); }
}

for (const phase of ['before', 'after']) test(`real MCP ${phase}-analysis IHC tracing keeps ping responsive, cancels slow Git and runs the next call`, { timeout: 10000 }, async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wisplab-mcp-tracing-')));
  const bin = join(dir, 'bin'), engine = join(dir, 'engine'), cfg = join(dir, 'config.json');
  const activeGit = join(dir, 'active-git'), allowGit = join(dir, 'allow-git'), input = join(dir, 'input.png'), calls = join(dir, 'engine-git-calls');
  mkdirSync(bin); mkdirSync(join(engine, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(input, 'fixture'); writeFileSync(join(engine, 'package.json'), '{"version":"fixture"}');
  writeFileSync(join(engine, 'node_modules', '.bin', 'tsx'), `#!${process.execPath}\nconsole.log('@@WISPLAB@@'+JSON.stringify({images:[{file:'input.png',value:7}]}));\n`, { mode: 0o755 });
  writeFileSync(cfg, JSON.stringify({ repos: { ihc: engine, wb: engine }, allowPaths: [dir] }));
  writeFileSync(join(bin, 'git'), `#!${process.execPath}
const fs=require('node:fs');
const engineCall=process.argv[3]===${JSON.stringify(engine)};
let count=fs.existsSync(${JSON.stringify(calls)})?Number(fs.readFileSync(${JSON.stringify(calls)},'utf8')):0;
if(engineCall) fs.writeFileSync(${JSON.stringify(calls)},String(++count));
if(!fs.existsSync(${JSON.stringify(allowGit)}) && (${JSON.stringify(phase)}==='before' || engineCall && count===2)) {
 fs.writeFileSync(${JSON.stringify(activeGit)},String(process.pid));
 setTimeout(()=>process.exit(1),5000);
} else {
 const result=require('node:child_process').spawnSync('git',process.argv.slice(2),{stdio:'inherit',env:{...process.env,PATH:${JSON.stringify(process.env.PATH)}}});
 process.exit(result.status??1);
}
`, { mode: 0o755 });
  const child = spawn(process.execPath, [resolve('mcp-server.mjs'), '--config', cfg], {
    env: { ...process.env, PATH: bin + delimiter + process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let closed = false;
  const close = new Promise(resolve => child.once('close', code => { closed = true; resolve(code); }));
  t.after(async () => { if (!closed) { child.kill('SIGKILL'); await close; } rmSync(dir, { recursive: true, force: true }); });
  const messages = []; let stderr = '';
  createInterface({ input: child.stdout }).on('line', line => messages.push(JSON.parse(line)));
  child.stderr.on('data', chunk => { stderr += chunk; });
  const send = value => child.stdin.write(JSON.stringify(value) + '\n');
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
  const call = (id, name) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { files: [input] }, _meta: meta } });
  send(call(1, 'ihc_quantify'));
  await eventually(() => existsSync(activeGit));
  const gitPid = Number(readFileSync(activeGit, 'utf8')), pingAt = Date.now();
  send({ jsonrpc: '2.0', id: 2, method: 'ping', params: { _meta: meta } });
  await eventually(() => messages.some(message => message.id === 2), 1000);
  assert.ok(Date.now() - pingAt < 1000, 'slow provenance Git blocked ping');
  send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
  await eventually(() => { try { process.kill(gitPid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } }, 1000);
  writeFileSync(allowGit, 'ready'); send(call(3, 'wb_quantify')); child.stdin.end();
  assert.equal(await close, 0, stderr);
  assert.equal(messages.some(message => message.id === 1), false);
  const following = messages.find(message => message.id === 3);
  assert.equal(following.result.isError, false, JSON.stringify(following));
  assert.equal(JSON.parse(following.result.content[0].text).images[0].value, 7);
});
