import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { checkVendorImages } from '../scripts/check-vendor-images.mjs';

const checks = { inputsUnchanged: true, engineUnchanged: true, bridgeUnchanged: true };
function fixture(t, omitted = []) {
  const root = mkdtempSync(join(tmpdir(), 'wisplab-vendor-batch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'sources.json'), JSON.stringify({ downloadedAt: 'synthetic', images: [{ file: 'images/a.jpg' }] }));
  for (const scene of ['he', 'masson', 'if']) if (!omitted.includes(scene)) {
    mkdirSync(join(root, 'images', scene), { recursive: true });
    writeFileSync(join(root, 'images', scene, 'a.jpg'), 'synthetic fixture; analysis is injected');
  }
  return { root, output: join(root, 'reports') };
}
const success = files => ({ files: files.map(path => ({ file: basename(path), overall: {} })), provenance: { checks } });

test('vendor scene failures preserve provenance and later scene/final reports', async t => {
  const { root, output } = fixture(t);
  const visited = [];
  const summary = await checkVendorImages(root, output, { analyze: async ({ files, profile, coloc }) => {
    visited.push(coloc ? 'if' : profile);
    if (profile === 'h_dab') throw Object.assign(new Error('browser startup failed'), { provenance: { status: 'error', checks } });
    return success(files);
  } });
  assert.deepEqual(visited, ['h_dab', 'h_eosin', 'masson', 'if']);
  assert.equal(summary.failed, true);
  assert.equal(summary.scenes[0].completed, 0);
  assert.equal(summary.scenes[0].errors[0].error, 'browser startup failed');
  assert.equal(summary.scenes[3].completed, 1);
  assert.equal(JSON.parse(readFileSync(join(output, 'dab.json'))).provenance.status, 'error');
  assert.deepEqual(JSON.parse(readFileSync(join(output, 'summary.json'))), summary);
});

test('missing scene directories are reported without preventing later analyses', async t => {
  const { root, output } = fixture(t, ['he']);
  const summary = await checkVendorImages(root, output, { analyze: async ({ files }) => success(files) });
  assert.equal(summary.scenes[1].total, null);
  assert.equal(summary.scenes[1].completed, 0);
  assert.match(summary.scenes[1].error, /ENOENT/);
  assert.equal(summary.scenes[2].completed, 1);
  assert.equal(summary.scenes[3].completed, 1);
  assert.equal(JSON.parse(readFileSync(join(output, 'he.json'))).files.length, 0);
  assert.equal(summary.failed, true);
});

test('mixed per-file errors and unchanged checks yield a failed aggregate, all-good runs succeed', async t => {
  const { root, output } = fixture(t);
  const summary = await checkVendorImages(root, output, { analyze: async ({ files, profile }) => profile === 'h_dab'
    ? { files: [{ file: 'a.jpg', error: 'corrupt image' }], provenance: { checks, status: 'error' } }
    : success(files) });
  assert.equal(summary.scenes[0].errors.length, 1);
  assert.equal(summary.failed, true);
  assert.equal((await checkVendorImages(root, output, { analyze: async ({ files }) => success(files) })).failed, false);
});
