import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { loadConfig, config, runIhc } from '../../lib.mjs';
import { sha256 } from '../../image-review.mjs';
import { histology, png } from './fixtures.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const lock = JSON.parse(readFileSync(new URL('../../engines.lock.json', import.meta.url)));

test('real IHC ROI / IF channels and local image review', { timeout: 180000 }, async t => {
  const cfg = loadConfig();
  assert.equal(execFileSync('git', ['-C', cfg.repos.ihc, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), lock.engines.ihc.revision);
  assert.equal(execFileSync('git', ['-C', cfg.repos.ihc, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'Use a clean pinned IHC engine');
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wisplab-image-review-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const cfgPath = join(dir, 'config.json');
  writeFileSync(cfgPath, JSON.stringify({ ...cfg, ihc: { devPort: port }, allowPaths: [dir] }));
  config(cfgPath);
  const write = (name, bytes) => { const path = join(dir, name); writeFileSync(path, bytes); return path; };
  const image = write('histology.png', histology());
  const roiManifest = { schemaVersion: 'wisplab.rois/v1', images: [{ file: basename(image), sha256: sha256(readFileSync(image)), coordinateSpace: 'source', sourceWidth: 128, sourceHeight: 96,
    rois: [{ id: 'blank', name: 'Blank / 空白', x: 0, y: 0, w: 8, h: 8 }, { id: 'tissue', name: 'Tissue / 组织', x: 8, y: 10, w: 116, h: 78 }] }] };

  await t.test('ROI metrics change by region while whole-image threshold and metrics remain stable', async () => {
    const baseline = await runIhc({ files: [image], mpp: 0.5 });
    const result = await runIhc({ files: [image], roiManifest, mpp: 0.5, reviewDir: dir });
    const file = result.files[0];
    assert.equal(file.error, undefined);
    assert.deepEqual(file.overall, baseline.files[0].overall);
    assert.equal(file.thresholdUsed, baseline.files[0].thresholdUsed);
    assert.equal(file.inputSha256, roiManifest.images[0].sha256);
    assert.equal(file.perRoi[0].pixelCount, 64);
    assert.equal(file.perRoi[0].totalNuclei, 0);
    assert.ok(file.perRoi[1].totalNuclei > 0);
    assert.ok(file.perRoi[1].positiveFraction > file.perRoi[0].positiveFraction);
    assert.deepEqual(file.roiMapping.rois[0].source, file.roiMapping.rois[0].working);
    assert.equal(file.settings.calibration.mpp, 0.5);
    assert.ok(file.overall.densityPerMm2 > 0);
    assert.equal(result.provenance.status, 'success');
    assert.equal(result.provenance.parameters.roiManifest.images[0].sha256, file.inputSha256);
    assert.equal(result.review.error, undefined);
    for (const artifact of Object.values(file.artifacts)) {
      const bytes = readFileSync(artifact.path);
      assert.equal(bytes.readUInt32BE(16), 128); assert.equal(bytes.readUInt32BE(20), 96);
      assert.equal(sha256(bytes), artifact.sha256);
    }
    assert.notEqual(file.artifacts.original.sha256, file.artifacts.overlay.sha256);
    const html = readFileSync(result.review.report, 'utf8');
    assert.ok(html.includes(file.inputSha256)); assert.ok(html.includes(result.provenance.runId));
    assert.ok(html.includes('sourceMpp')); assert.ok(html.includes('roiMapping'));
  });

  await t.test('large source maps with actual X/Y scales and records area-equivalent working mpp', async () => {
    const large = write('large.png', png(8193, 65, 3, 8, () => [245, 245, 245]));
    const manifest = { schemaVersion: 'wisplab.rois/v1', images: [{ file: basename(large), sha256: sha256(readFileSync(large)), coordinateSpace: 'source', sourceWidth: 8193, sourceHeight: 65,
      rois: [{ id: 'r1', name: 'ROI', x: 3, y: 5, w: 100, h: 37 }] }] };
    const result = await runIhc({ files: [large], roiManifest: manifest, mpp: 0.5 });
    const file = result.files[0]; assert.equal(file.error, undefined);
    assert.equal(file.width, 4096); assert.equal(file.height, 32);
    const sx = 4096 / 8193, sy = 32 / 65;
    assert.deepEqual(file.roiMapping.rois[0].working, { x: Math.floor(3 * sx), y: Math.floor(5 * sy), w: Math.ceil(103 * sx) - Math.floor(3 * sx), h: Math.ceil(42 * sy) - Math.floor(5 * sy) });
    assert.equal(file.settings.calibration.mpp, 0.5 / Math.sqrt(sx * sy));
  });

  await t.test('hash and source-size mismatches are explicit per-file failures', async () => {
    const second = write('second.png', histology());
    const manifest = structuredClone(roiManifest);
    manifest.images.push({ ...manifest.images[0], file: basename(second), sha256: '0'.repeat(64) });
    const result = await runIhc({ files: [image, second], roiManifest: manifest });
    assert.equal(result.files[0].error, undefined);
    assert.match(result.files[1].error, /SHA-256 mismatch/);
    assert.equal(result.provenance.status, 'partial-error');
    const wrongSize = structuredClone(roiManifest); wrongSize.images[0].sourceWidth = 129;
    const mismatch = await runIhc({ files: [image], roiManifest: wrongSize });
    assert.match(mismatch.files[0].error, /dimensions mismatch/);
  });

  await t.test('actual RGB selection changes IF Pearson and is exposed by CLI and MCP', async () => {
    const fluorescence = write('rgb.png', png(64, 32, 3, 8, x => [x * 4, x * 4, (63 - x) * 4]));
    const rg = await runIhc({ files: [fluorescence], coloc: true });
    const rb = await runIhc({ files: [fluorescence], coloc: true, channels: ['R', 'B'], reviewDir: dir });
    assert.equal(rg.files[0].coloc.pearsonAll, 1);
    assert.ok(rb.files[0].coloc.pearsonAll < -0.99);
    assert.deepEqual(rb.files[0].settings.channels, ['R', 'B']);
    assert.equal(rb.files[0].settings.coloc.channelB, 2);
    const roiPath = write('rois.json', JSON.stringify(roiManifest));
    const cli = spawnSync(process.execPath, [join(root, 'cli.mjs'), 'ihc', image, '--roi-manifest', roiPath, '--mpp', '0.5', '--review-dir', dir, '--config', cfgPath], { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
    assert.equal(cli.status, 0, cli.stderr);
    const cliResult = JSON.parse(cli.stdout);
    assert.equal(cliResult.files[0].perRoi.length, 2); assert.equal(cliResult.review.selfContained, true);
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'if_colocalize', arguments: { files: [fluorescence], channels: ['R', 'B'], reviewDir: dir },
      _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } };
    const mcp = spawnSync(process.execPath, [join(root, 'mcp-server.mjs'), '--config', cfgPath], { input: JSON.stringify(request) + '\n', encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
    assert.equal(mcp.status, 0, mcp.stderr);
    const reply = JSON.parse(mcp.stdout); assert.equal(reply.result.isError, false);
    const mcpResult = JSON.parse(reply.result.content[0].text);
    assert.equal(mcpResult.files[0].coloc.pearsonAll, rb.files[0].coloc.pearsonAll);
    assert.equal(mcpResult.review.selfContained, true);
  });
});
