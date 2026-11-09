import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from '../lib.mjs';
import { createMcpHandler } from '../mcp-server.mjs';

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'verify-compat-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'engine'), verify = join(dir, 'verify');
  mkdirSync(join(repo, 'node_modules', '.bin'), { recursive: true }); mkdirSync(verify);
  writeFileSync(join(repo, 'node_modules', '.bin', 'tsx'), `#!${process.execPath}\n`, { mode: 0o755 });
  writeFileSync(join(verify, 'dump_app.ts'), '');
  const config = join(dir, 'config.json');
  writeFileSync(config, JSON.stringify({ repos: { pcr: repo }, allowPaths: [dir], verify: { allowMcp: true, dir: verify } }));
  return { dir, verify, config };
}

test('verify-pcr CLI preserves script imports and caller working directory', t => {
  const { dir, verify, config } = fixture(t);
  writeFileSync(join(verify, 'local_helper.py'), 'value = "local-import-ok"\n');
  writeFileSync(join(dir, 'caller-data.txt'), 'caller-cwd-ok');
  writeFileSync(join(verify, 'reference_check.py'), 'import local_helper\nprint(local_helper.value)\nprint(open("caller-data.txt").read())\n');
  const result = spawnSync(process.execPath, [resolve('cli.mjs'), 'verify-pcr', verify, '--config', config], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /local-import-ok/);
  assert.match(result.stdout, /caller-cwd-ok/);
});

test('MCP verification worker isolates Python from local module shadowing', async t => {
  const { dir, verify, config } = fixture(t);
  writeFileSync(join(verify, 'json.py'), 'raise RuntimeError("shadowed stdlib")\n');
  writeFileSync(join(verify, 'reference_check.py'), 'import json, os, sys\nprint(json.dumps({"cwd": os.getcwd(), "isolated": sys.flags.isolated}))\n');
  const handler = createMcpHandler({ cfg: loadConfig(config) });
  const result = await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pcr_verify', arguments: {}, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } });
  assert.equal(result.result?.isError, false, JSON.stringify(result));
  const output = JSON.parse(result.result.content[0].text);
  assert.equal(output.exitCode, 0, output.output);
  assert.deepEqual(JSON.parse(output.output), { cwd: verify, isolated: 1 });
});
