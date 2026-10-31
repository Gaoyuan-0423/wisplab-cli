import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAnnotationPack } from '../ihc-annotation-pack.mjs';
import { makeAnnotationTemplate } from '../ihc-nuclei-validation.mjs';
import { png } from './integration/fixtures.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
function fixture(t, name = 'sample.png') {
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-annotation-unit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bytes = png(16, 12, 3, 8, () => [245, 245, 245]);
  const hash = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(dir, name), bytes);
  const result = { files: [{ file: name, sourceWidth: 16, sourceHeight: 12, width: 8, height: 6, settings: { profile: 'h_dab' },
    nuclei: { coordinateSpace: 'working', width: 8, height: 6, items: [{ id: 'secret-model-prediction', x: 3, y: 2, positive: true }] } }],
    provenance: { analysis: 'ihc', inputs: [{ file: name, role: 'input', before: { sha256: hash }, after: { sha256: hash }, unchanged: true }] } };
  return { dir, bytes, hash, result };
}

test('annotation packs contain original hashed bytes and empty pending references without predictions', t => {
  const { dir, bytes, hash, result } = fixture(t);
  const pack = createAnnotationPack(result, { imagesRoot: dir, outputDir: dir });
  assert.equal(pack.status, 'pending-independent-review');
  assert.equal(pack.images, 1);
  const reference = JSON.parse(readFileSync(pack.template));
  assert.deepEqual(reference, makeAnnotationTemplate(result));
  const entry = reference.images[0];
  assert.equal(entry.sha256, hash); assert.equal(entry.coordinateSpace, 'source');
  assert.equal(entry.sourceWidth, 16); assert.equal(entry.sourceHeight, 12);
  assert.equal(entry.reviewStatus, 'pending'); assert.equal(entry.sourceKind, 'manual');
  assert.equal(entry.reviewer, ''); assert.equal(entry.reviewedOn, ''); assert.equal(entry.method, '');
  assert.deepEqual(entry.points, []);
  const html = readFileSync(pack.html, 'utf8');
  assert.ok(html.includes(`data:image/png;base64,${bytes.toString('base64')}`));
  assert.doesNotMatch(html, /secret-model-prediction/);
  assert.match(html, /not segmentation masks/);
  assert.notEqual(pack.directory, dir);
});

test('untrusted file names cannot escape inline JSON into executable markup', t => {
  const { dir, result } = fixture(t, '<img src=x onerror="attack()">.png');
  const pack = createAnnotationPack(result, { imagesRoot: dir, outputDir: dir });
  const html = readFileSync(pack.html, 'utf8');
  assert.doesNotMatch(html, /<img src=x/);
  assert.ok(html.includes('\\u003cimg src=x'));
  assert.match(html, /o\.textContent=r\.file/);
});

test('changed source bytes, unstable provenance, ambiguous names and unsupported formats fail explicitly', t => {
  const { dir, result } = fixture(t);
  writeFileSync(join(dir, 'sample.png'), 'changed');
  assert.throws(() => createAnnotationPack(result, { imagesRoot: dir, outputDir: dir }), /hash differs/);
  const badInput = structuredClone(result); badInput.provenance.inputs[0].unchanged = false;
  assert.throws(() => makeAnnotationTemplate(badInput), /stable input hash/);
  const duplicate = structuredClone(result); duplicate.files.push({ ...duplicate.files[0] });
  assert.throws(() => makeAnnotationTemplate(duplicate), /uniquely named/);
  const noProfile = structuredClone(result); delete noProfile.files[0].settings.profile;
  assert.throws(() => makeAnnotationTemplate(noProfile));
  const unsupported = Buffer.from([73, 73, 42, 0, 8, 0, 0, 0]);
  writeFileSync(join(dir, 'sample.png'), unsupported);
  const hash = createHash('sha256').update(unsupported).digest('hex');
  result.provenance.inputs[0].before.sha256 = hash; result.provenance.inputs[0].after.sha256 = hash;
  assert.throws(() => createAnnotationPack(result, { imagesRoot: dir, outputDir: dir }), /original PNG\/JPEG/);
});

test('offline annotation CLI requires no engine config and preserves pending status', t => {
  const { dir, result } = fixture(t);
  const resultPath = join(dir, 'result.json'); writeFileSync(resultPath, JSON.stringify(result));
  const cli = spawnSync(process.execPath, [join(root, 'cli.mjs'), 'ihc-annotation-pack', resultPath, '--images-root', dir, '--output-dir', dir,
    '--config', join(dir, 'intentionally-absent-config.json')], { encoding: 'utf8', cwd: dir, timeout: 10000 });
  assert.equal(cli.status, 0, cli.stderr);
  const pack = JSON.parse(cli.stdout);
  assert.equal(pack.status, 'pending-independent-review');
  assert.equal(JSON.parse(readFileSync(pack.template)).images[0].reviewStatus, 'pending');
});
