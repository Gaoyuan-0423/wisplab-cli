import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { loadConfig } from '../../lib.mjs';

const close = (actual, expected, tolerance = 1e-12) =>
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

// Build GUI archives with the actual model and original synthetic PNG pixels.
// The saved 8x4 manual ROIs are smaller than the 12x6 bands in the source image.
const fixtureSource = String.raw`
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  createRealProject, applyLaneDescription, applyNormalization, applyPairedDesign,
  importRealImages, updateRealImage, updateRealProject, exportRealProject,
  results, descriptiveStatistics, realPairedTests,
} from '<WB>/src/real/model.ts';
import { png } from '<FIXTURES>';
const require = createRequire('<WB>/package.json');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const dir = process.argv[2];
const regions = () => [2, 22].map((x, index) => ({
  lane: index + 1, band: {x, y: 6, width: 8, height: 4},
  background: {x, y: 16, width: 8, height: 4}, source: 'manual',
}));
function review(project) {
  project = updateRealProject(project, {designConfirmed: true, statisticalTest: 'paired-t'});
  for (const image of [...project.images].sort((a, b) =>
    a.role === b.role ? 0 : a.role === 'reference' ? -1 : 1))
    project = updateRealImage(project, image.id, {reviewed: true});
  return project;
}
async function build(depth, signal, kind) {
  let project = applyLaneDescription(createRealProject('Saved manual ROIs'), 'NC,Treatment');
  project = applyNormalization(project, {kind: 'matched-control'});
  project = updateRealProject(project, {
    statisticalTest: 'paired-t',
    backgroundCorrection: kind === 'local' ? {kind} : {kind, radius: 50},
  });
  const scale = depth === 16 ? 257 : 1;
  const files = [1, 2, 3].flatMap((replicate, index) =>
    ['target', 'reference'].map(role => {
      const contrasts = role === 'target' ? [[40, 20], [80, 60], [60, 60]][index] : [30, 30];
      const seed = replicate + (role === 'reference' ? 4 : 0);
      return {
        name: (role === 'target' ? 'Protein_' : 'tublin_') + replicate + '.png',
        bytes: png(40, 24, 1, depth, (x, y) => {
          const lane = x >= 1 && x < 13 ? 0 : x >= 21 && x < 33 ? 1 : -1;
          const contrast = y >= 5 && y < 11 && lane >= 0 ? contrasts[lane] : 0;
          return [(signal === 'dark' ? 220 + seed - contrast : 20 + seed + contrast) * scale];
        }),
      };
    }));
  project = await importRealImages(project, files);
  for (const image of project.images)
    project = updateRealImage(project, image.id, {regions: regions(), signal});
  return review(project);
}
const expected = {};
async function save(name, project) {
  const bytes = new Uint8Array(await (await exportRealProject(project)).arrayBuffer());
  writeFileSync(join(dir, name + '.realwb.zip'), bytes);
  expected[name] = {
    results: results(project), statistics: descriptiveStatistics(project), pairedTests: realPairedTests(project),
    images: project.images.map(({bytes, history, hash, ...image}) => ({...image, sha256: hash, historyCount: history.length})),
  };
  return bytes;
}
let base;
for (const kind of ['local', 'rolling-ball']) for (const depth of [8, 16]) for (const signal of ['dark', 'light']) {
  const project = await build(depth, signal, kind);
  await save(kind + '-' + depth + '-' + signal, project);
  if (kind === 'local' && depth === 8 && signal === 'dark') base = project;
}
const first = base.images.find(image => image.role === 'target');
const changedRegions = regions();
changedRegions[1].band.width = 4;
await save('changed-roi', updateRealImage(base, first.id, {regions: changedRegions}));
await save('shared', review(applyNormalization(base, {kind: 'reference-unit', unitId: '1'})));
const pairs = [1, 2, 3].map(i => ({groupId: String(i), unitId: 'P' + i, normalLane: 1, tumorLane: 2}));
await save('paired', review(applyPairedDesign(base, pairs)));
await save('duplicate-unit', review(applyPairedDesign(base, pairs.map(pair =>
  ({...pair, unitId: pair.groupId === '2' ? 'P1' : pair.unitId})))));
await save('unconfirmed', updateRealProject(base, {designConfirmed: false}));
await save('disabled', updateRealProject(base, {statisticalTest: 'none'}));
await save('unreviewed', updateRealImage(base, first.id, {reviewed: false}));
await save('missing-roi', updateRealImage(base, first.id, {regions: []}));
await save('excluded', updateRealImage(base, first.id, {excluded: true}));
const entries = unzipSync(await save('good', base));
const manifest = JSON.parse(strFromU8(entries['manifest.json']));
manifest.images[0].hash = '0'.repeat(64);
entries['manifest.json'] = strToU8(JSON.stringify(manifest));
writeFileSync(join(dir, 'bad-hash.realwb.zip'), zipSync(entries));
writeFileSync(join(dir, 'bad-archive.realwb.zip'), new Uint8Array([1, 2, 3]));
writeFileSync(join(dir, 'expected.json'), JSON.stringify(expected));
`;

test('saved WB projects replay through the pinned GUI model', {timeout: 120000}, async t => {
  const cfg = loadConfig();
  const lock = JSON.parse(readFileSync(new URL('../../engines.lock.json', import.meta.url)));
  const git = (...args) => execFileSync('git', ['-C', cfg.repos.wb, ...args], {encoding: 'utf8'}).trim();
  assert.equal(git('rev-parse', 'HEAD'), lock.engines.wb.revision);
  assert.equal(git('status', '--porcelain'), '');
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-wb-replay-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const engineRequire = createRequire(join(cfg.repos.wb, 'package.json'));
  const loader = pathToFileURL(engineRequire.resolve('tsx')).href;
  const replace = source => source.replaceAll('<WB>', pathToFileURL(cfg.repos.wb).href);
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  const runner = join(dir, 'wb-replay-run.ts');
  writeFileSync(runner, replace(readFileSync(new URL('../../runners/wb-replay-run.ts', import.meta.url), 'utf8')));
  const builder = join(dir, 'build-fixtures.ts');
  writeFileSync(builder, replace(fixtureSource).replace('<FIXTURES>', new URL('./fixtures.mjs', import.meta.url).href));
  const execute = (script, argument) => execFileSync(process.execPath, ['--import', loader, script, argument], {
    encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024,
  });
  execute(builder, dir);
  const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
  const path = name => join(dir, name + '.realwb.zip');
  const digest = name => createHash('sha256').update(readFileSync(path(name))).digest('hex');
  const replay = names => {
    const stdout = execute(runner, JSON.stringify({files: names.map(path)}));
    const line = stdout.split('\n').find(line => line.startsWith('@@WISPLAB@@'));
    assert.ok(line, stdout);
    const result = JSON.parse(line.slice('@@WISPLAB@@'.length));
    assert.equal(result.schemaVersion, 'wisplab.wb-replay/v1');
    assert.equal(result.mode, 'saved-project');
    assert.equal(result.proposalsRun, false);
    return result.files;
  };
  const matchesGui = (file, name) => {
    assert.equal(file.error, undefined, file.error);
    for (const key of ['results', 'statistics', 'pairedTests', 'images'])
      assert.deepEqual(file[key], expected[name][key], name + ': ' + key);
  };

  await t.test('manual local ROIs preserve exact 8/16-bit dark/light measurements and paired inference', () => {
    const names = [8, 16].flatMap(depth => ['dark', 'light'].map(signal => `local-${depth}-${signal}`));
    replay(names).forEach((file, index) => {
      matchesGui(file, names[index]);
      const scale = names[index].includes('-16-') ? 257 : 1;
      assert.deepEqual(file.results.map(row => row.targetNet), [40, 20, 80, 60, 60, 60].map(v => 32 * v * scale));
      assert.deepEqual(file.results.map(row => row.referenceNet), Array(6).fill(32 * 30 * scale));
      assert.equal(file.results[0].ratio, 4 / 3);
      assert.deepEqual(file.results.filter(row => row.sample === 'Treatment').map(row => row.fold), [0.5, 0.75, 1]);
      assert.ok(file.results.every(row => row.status === 'ready'));
      const summary = file.statistics.find(row => row.sample === 'Treatment');
      assert.equal(summary.n, 3); assert.equal(summary.mean, 0.75); assert.equal(summary.sd, 0.25);
      const inference = file.pairedTests[0];
      assert.equal(inference.result.n, 3); assert.equal(inference.result.df, 2);
      assert.equal(inference.result.inputBasis, 'target/reference');
      close(inference.result.t, -2);
      // Closed-form two-sided Student t survival probability for df = 2.
      close(inference.result.pValue, 1 - 2 / Math.sqrt(6), 1e-10);
      assert.deepEqual(inference.inputPairs.map(pair => pair.control), [4 / 3, 8 / 3, 2]);
    });
  });

  await t.test('saved rolling-ball radius and both signal polarities use the GUI engine at both depths', () => {
    const names = [8, 16].flatMap(depth => ['dark', 'light'].map(signal => `rolling-ball-${depth}-${signal}`));
    replay(names).forEach((file, index) => {
      matchesGui(file, names[index]);
      assert.deepEqual(file.settings.backgroundCorrection, {kind: 'rolling-ball', radius: 50});
      assert.ok(file.results.every(row => row.backgroundMethod === 'rolling-ball' && row.rollingBallRadius === 50));
      assert.ok(file.results.every(row => Number.isFinite(row.targetNet) && row.targetNet > 0));
      assert.equal(file.images[0].signal, names[index].endsWith('light') ? 'light' : 'dark');
    });
  });

  await t.test('a saved manual ROI change alters its exact integral and retains revision/review state', () => {
    const [before, after] = replay(['good', 'changed-roi']);
    matchesGui(after, 'changed-roi');
    assert.equal(before.results[1].targetNet, 640);
    assert.equal(after.results[1].targetNet, 320);
    assert.equal(after.results[1].fold, 0.25);
    assert.equal(after.images[0].regions[1].band.width, 4);
    assert.equal(after.images[0].regions[1].source, 'manual');
    assert.equal(after.images[0].reviewed, false);
    assert.ok(after.images[0].revision > before.images[0].revision);
    assert.ok(after.images[0].historyCount > before.images[0].historyCount);
  });

  await t.test('normalization changes plots while explicit individual pairs control n and raw-ratio inference', () => {
    const names = ['good', 'shared', 'paired', 'duplicate-unit'];
    const files = replay(names);
    files.forEach((file, i) => matchesGui(file, names[i]));
    const [base, shared, paired, duplicate] = files;
    assert.deepEqual(shared.results.filter(row => row.sample === 'NC').map(row => row.fold), [1, 2, 1.5]);
    const pairValues = file => file.pairedTests[0].inputPairs.map(({id, control, treatment}) => ({id, control, treatment}));
    assert.deepEqual(pairValues(shared), pairValues(base));
    assert.deepEqual(shared.pairedTests[0].result, base.pairedTests[0].result);
    assert.ok(shared.results.every(row => row.status === 'draft'));
    assert.deepEqual(paired.statistics.map(row => [row.sample, row.n, row.unitLabel]), [['N', 3, 'individuals'], ['T', 3, 'individuals']]);
    assert.deepEqual(paired.pairedTests[0].inputPairs.map(pair => pair.id), ['P1', 'P2', 'P3']);
    assert.deepEqual(duplicate.statistics.map(row => row.n), [1, 1]);
    assert.deepEqual(duplicate.statistics[0].replicates, ['P3']);
  });

  await t.test('unreviewed, incomplete, excluded and unconfirmed projects remain as saved without ROI repair', () => {
    const names = ['unreviewed', 'missing-roi', 'excluded', 'unconfirmed', 'disabled'];
    const files = replay(names);
    files.forEach((file, i) => matchesGui(file, names[i]));
    const [unreviewed, missing, excluded, unconfirmed, disabled] = files;
    assert.equal(unreviewed.images[0].reviewed, false);
    assert.ok(unreviewed.results.slice(0, 2).every(row => row.status === 'draft'));
    assert.deepEqual(missing.images[0].regions, []);
    assert.ok(missing.results.slice(0, 2).every(row => row.status === 'blocked' && row.fold === null && row.targetNet === null));
    assert.deepEqual(missing.statistics.map(row => row.n), [2, 2]);
    assert.equal(excluded.images[0].excluded, true);
    assert.ok(excluded.results.slice(0, 2).every(row => row.status === 'blocked'));
    assert.deepEqual(excluded.statistics.map(row => row.n), [2, 2]);
    assert.equal(unconfirmed.settings.designConfirmed, false);
    assert.equal(unconfirmed.pairedTests[0].reason, 'design-unconfirmed');
    assert.equal(disabled.pairedTests[0].reason, 'test-disabled');
  });

  await t.test('corrupt archives and image hashes fail independently in a good-bad-good batch without writes', () => {
    const names = ['good', 'bad-hash', 'bad-archive', 'good'];
    const hashes = names.map(digest);
    const [first, badHash, badArchive, last] = replay(names);
    matchesGui(first, 'good');
    assert.match(badHash.error, /checksum/i);
    assert.equal(typeof badArchive.error, 'string'); assert.ok(badArchive.error.length);
    assert.equal(badHash.results, undefined); assert.equal(badArchive.results, undefined);
    assert.deepEqual(last, first);
    assert.deepEqual(names.map(digest), hashes);
    assert.equal(git('status', '--porcelain'), '');
  });
});
