import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadConfig } from '../../lib.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const meta = {'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}};

test('actual CLI and MCP replay saved projects through the pinned WB engine', {timeout: 90000}, t => {
  const cfg = loadConfig();
  const lock = JSON.parse(readFileSync(join(root, 'engines.lock.json')));
  assert.equal(execFileSync('git', ['-C', cfg.repos.wb, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), lock.engines.wb.revision);
  assert.equal(execFileSync('git', ['-C', cfg.repos.wb, 'status', '--porcelain'], {encoding: 'utf8'}).trim(), '');
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-replay-dispatch-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const good = join(dir, 'example.realwb.zip'), bad = join(dir, 'invalid.realwb.zip'), configPath = join(dir, 'config.json');
  // The upstream bundled real-workspace example contains generated synthetic data.
  copyFileSync(join(cfg.repos.wb, 'public/examples/real/example.realwb.zip'), good);
  writeFileSync(bad, 'not a project archive');
  writeFileSync(configPath, JSON.stringify({...cfg, allowPaths: [dir]}));
  const hash = createHash('sha256').update(readFileSync(good)).digest('hex');
  for (const files of [[good], [good, bad, good]]) {
    const partialError = files.length > 1;
    const cli = spawnSync(process.execPath, [join(root, 'cli.mjs'), 'wb-replay', ...files, '--config', configPath], {
      encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(cli.status, partialError ? 1 : 0, cli.stderr);
    const cliResult = JSON.parse(cli.stdout);
    assert.equal(cliResult.provenance.analysis, 'wb-replay');
    assert.equal(cliResult.provenance.status, partialError ? 'partial-error' : 'success');
    assert.deepEqual(cliResult.provenance.checks, {inputsUnchanged: true, engineUnchanged: true, bridgeUnchanged: true});
    assert.equal(cliResult.provenance.inputs[0].role, 'project-archive');
    assert.equal(cliResult.provenance.inputs[0].before.sha256, hash);
    assert.equal(cliResult.provenance.engine.before.revision, lock.engines.wb.revision);
    assert.ok(cliResult.files[0].results.length);
    assert.equal(cliResult.proposalsRun, false);
    if (partialError) {
      assert.ok(cliResult.files[1].error);
      assert.deepEqual(cliResult.files[2], cliResult.files[0]);
    }

    const message = {jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'wb_replay', arguments: {files}, _meta: meta}};
    const mcp = spawnSync(process.execPath, [join(root, 'mcp-server.mjs'), '--config', configPath], {
      input: JSON.stringify(message) + '\n', encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(mcp.status, 0, mcp.stderr);
    const response = JSON.parse(mcp.stdout);
    assert.equal(response.result.isError, partialError);
    const mcpResult = JSON.parse(response.result.content[0].text);
    assert.deepEqual(mcpResult.files, cliResult.files);
    assert.equal(mcpResult.provenance.analysis, 'wb-replay');
    assert.equal(mcpResult.provenance.status, cliResult.provenance.status);
    assert.deepEqual(mcpResult.provenance.checks, cliResult.provenance.checks);
  }
});
