import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeImageOptions, saveImageReview, sha256 } from '../image-review.mjs';
import { createMcpHandler } from '../mcp-server.mjs';
import { png } from './integration/fixtures.mjs';

const manifest = () => ({ schemaVersion: 'wisplab.rois/v1', images: [{ file: 'sample.png', sha256: 'a'.repeat(64), coordinateSpace: 'source', sourceWidth: 100, sourceHeight: 80,
  rois: [{ id: 'r1', name: 'Tumor', x: 10, y: 20, w: 30, h: 40 }] }] });
const options = (extra = {}) => normalizeImageOptions({ files: ['/tmp/sample.png'], ...extra });

test('ROI manifests bind unique file names, hashes, integer source rectangles and complete batch coverage', () => {
  assert.deepEqual(options({ roiManifest: manifest() }).roiManifest, manifest());
  for (const mutate of [
    m => m.images[0].rois[0].x = 71, m => m.images[0].rois[0].y = -1,
    m => m.images[0].rois[0].w = 0, m => m.images[0].rois[0].h = 1.2,
    m => m.images[0].sha256 = 'a'.repeat(63), m => m.images[0].coordinateSpace = 'working',
    m => m.images[0].file = '../sample.png', m => m.images[0].rois.push({ ...m.images[0].rois[0] }),
    m => m.images[0].rois[0].extra = 3, m => m.images[0].sourceWidth = 0,
    m => m.images.push({ ...m.images[0] }), m => m.images[0].file = 'other.png',
  ]) { const m = manifest(); mutate(m); assert.throws(() => options({ roiManifest: m })); }
  assert.throws(() => options({ roiManifest: manifest(), files: ['/tmp/sample.png', '/tmp/missing.png'] }), /every input/);
  assert.throws(() => options({ roiManifest: manifest(), files: ['/tmp/sample.png', '/tmp/other/sample.png'] }), /every input/);
  assert.throws(() => options({ roiManifest: manifest(), coloc: true }), /IHC only/);
});

test('IF channel selection and source mpp reject unsupported combinations', () => {
  assert.deepEqual(options({ coloc: true }).channels, ['R', 'G']);
  assert.deepEqual(options({ coloc: true, channels: ['B', 'R'] }).channels, ['B', 'R']);
  for (const channels of [['R', 'R'], ['R'], ['R', 'G', 'B'], [0, 1], ['red', 'G']]) assert.throws(() => options({ coloc: true, channels }));
  assert.throws(() => options({ channels: ['R', 'B'] }));
  for (const mpp of [0, -1, Infinity, NaN, '0.5', 1e-200, 1e200]) assert.throws(() => options({ mpp }));
  assert.throws(() => options({ coloc: true, mpp: 0.5 }));
  assert.throws(() => options({ coloc: true, includeNuclei: true }));
  assert.equal(options({ mpp: 0.5 }).mpp, 0.5);
});

test('review export is self-contained, escaped, original-sized and stripped of transient data', t => {
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-report-unit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bytes = png(3, 2, 3, 8, () => [100, 20, 50]);
  const uri = `data:image/png;base64,${bytes.toString('base64')}`;
  const result = saveImageReview({ files: [{ file: '<img src=x onerror="alert(1)">.png', width: 3, height: 2, reviewImages: { original: uri, overlay: uri }, warnings: ['</pre><script>alert(2)</script>'] }, { file: 'broken.png', error: '<bad>' }], provenance: { note: '<injected>' } }, dir);
  assert.equal(result.review.selfContained, true);
  assert.equal(result.files[0].reviewImages, undefined);
  const html = readFileSync(result.review.report, 'utf8');
  assert.match(html, /default-src 'none'/);
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|onerror="|src="https?:/);
  assert.equal(sha256(Buffer.from(html)), result.review.sha256);
  assert.deepEqual(readFileSync(result.files[0].artifacts.overlay.path), bytes);
  assert.equal(result.files[0].artifacts.overlay.sha256, sha256(bytes));
  assert.match(html, /not nucleus boundaries/);
  const json = JSON.parse(readFileSync(join(result.review.directory, 'result.json')));
  assert.deepEqual(json.review, result.review);
  assert.equal(json.files[0].reviewImages, undefined);
});

test('export failure retains scientific results and removes base64 payloads', t => {
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-report-fail-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = saveImageReview({ files: [{ file: 'a.png', overall: { totalNuclei: 4 }, reviewImages: { original: 'bad' } }] }, dir);
  assert.match(result.review.error, /Invalid review PNG/);
  assert.equal(result.files[0].overall.totalNuclei, 4);
  assert.equal(result.files[0].reviewImages, undefined);
});

test('MCP review output directories obey allowPaths and symlink boundaries', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-report-policy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const allowed = join(dir, 'allowed'), outside = join(dir, 'outside');
  mkdirSync(allowed); mkdirSync(outside); symlinkSync(outside, join(allowed, 'escape'));
  const input = join(allowed, 'input.png'); writeFileSync(input, 'fixture');
  let calls = 0;
  const handle = createMcpHandler({ cfg: { allowPaths: [allowed] }, engine: { runIhc: async () => { calls++; return {}; } } });
  for (const reviewDir of [outside, join(allowed, 'escape')]) {
    const reply = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'if_colocalize', arguments: { files: [input], reviewDir },
      _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } });
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /outside allowPaths/);
  }
  assert.equal(calls, 0);
});
