import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { loadConfig, config, runIhc } from '../../lib.mjs';
import { histology, fluorescence } from './fixtures.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const lock = JSON.parse(readFileSync(new URL('../../engines.lock.json', import.meta.url)));

test('real IHC/IF batches retain good files around failures', { timeout: 180000 }, async t => {
  const cfg = loadConfig();
  assert.equal(execFileSync('git', ['-C', cfg.repos.ihc, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), lock.engines.ihc.revision);
  assert.equal(execFileSync('git', ['-C', cfg.repos.ihc, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'Use a clean pinned IHC engine');
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wisplab-image-batch-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const cfgPath = join(dir, 'config.json');
  writeFileSync(cfgPath, JSON.stringify({ ...cfg, ihc: { devPort: port }, allowPaths: [dir] }));
  config(cfgPath);
  const write = (name, bytes) => { const path = join(dir, name); writeFileSync(path, bytes); return path; };
  const broken = write('broken.png', 'not an image');
  const ihcFiles = [write('ihc-first.png', histology()), broken, write('ihc-last.png', histology())];
  const ifFiles = [write('if-first.png', fluorescence()), broken, write('if-last.png', fluorescence())];
  const assertPartial = (result, files, inputsUnchanged = true) => {
    assert.equal(result.files.length, files.length);
    assert.deepEqual(result.files.map(file => file.file), files.map(file => basename(file)));
    assert.equal(result.files[0].error, undefined);
    assert.equal(typeof result.files[1].error, 'string');
    assert.ok(result.files[1].error.length > 0);
    assert.equal(result.files[2].error, undefined);
    assert.deepEqual(result.files[0].overall, result.files[2].overall);
    assert.equal(result.provenance.status, 'partial-error');
    assert.deepEqual(result.provenance.checks, { inputsUnchanged, engineUnchanged: true, bridgeUnchanged: true });
  };

  await t.test('decoding a corrupt file leaves earlier and later IHC/IF measurements intact', async () => {
    assertPartial(await runIhc({ files: ihcFiles }), ihcFiles);
    const result = await runIhc({ files: ifFiles, coloc: true });
    assertPartial(result, ifFiles);
    assert.equal(result.files[0].coloc.pearsonAll, 1);
    assert.equal(result.files[2].coloc.pearsonAll, 1);
  });

  await t.test('a missing input is a per-file read error and remains unverified in provenance', async () => {
    const files = [ihcFiles[0], join(dir, 'missing.png'), ihcFiles[2]];
    const result = await runIhc({ files });
    assertPartial(result, files, false);
    assert.match(result.files[1].error, /ENOENT/);
    assert.equal(result.provenance.inputs[1].unchanged, false);
  });

  await t.test('real CLI exits 1 and MCP isError retains partial results', () => {
    const cli = spawnSync(process.execPath, [join(root, 'cli.mjs'), 'ihc', ...ihcFiles, '--config', cfgPath], {
      encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024,
    });
    assert.equal(cli.status, 1, cli.stderr);
    assertPartial(JSON.parse(cli.stdout), ihcFiles);
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'if_colocalize', arguments: { files: ifFiles },
      _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} },
    } };
    const mcp = spawnSync(process.execPath, [join(root, 'mcp-server.mjs'), '--config', cfgPath], {
      input: JSON.stringify(request) + '\n', encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024,
    });
    assert.equal(mcp.status, 0, mcp.stderr);
    const reply = JSON.parse(mcp.stdout);
    assert.equal(reply.result.isError, true);
    assertPartial(JSON.parse(reply.result.content[0].text), ifFiles);
  });
});
