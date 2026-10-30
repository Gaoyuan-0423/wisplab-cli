import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Minimal upstream interfaces exercise the bridge without installing all three engines.
// Real engine smoke checks are recorded separately in the verification report.
function fixture(t, kind, modules) {
  const dir = mkdtempSync(join(tmpdir(), 'wisplab-runner-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let source = readFileSync(new URL(`../runners/${kind}-run.ts`, import.meta.url), 'utf8');
  for (const [name, code] of Object.entries(modules)) {
    const path = join(dir, `${name.replaceAll('/', '-')}.mjs`);
    writeFileSync(path, code);
    source = source.replace(`<${kind.toUpperCase()}>/src/${name}.ts`, path);
  }
  source = source.replaceAll("<CLI>", new URL("..", import.meta.url).href.replace(/\/$/, ""));
  const runner = join(dir, 'runner.mjs');
  writeFileSync(runner, source);
  return { dir, run(payload) {
    const result = spawnSync(process.execPath, [runner, JSON.stringify(payload)], { encoding: 'utf8' });
    const line = result.stdout.split('\n').find((l) => l.startsWith('@@WISPLAB@@'));
    return { ...result, data: line && JSON.parse(line.slice('@@WISPLAB@@'.length)) };
  } };
}

function wbFixture(t) {
  const f = fixture(t, 'wb', {
    'real/pixels': `
      export function decodeRaster() { return { width: 20, height: 20, bitDepth: 8, pixels: new Float64Array(400) }; }
      export function proposeRegions() { return [1, 2].map(lane => ({ lane, source: 'automatic', band: {x: 1, y: 1, width: 1, height: 1}, background: {x: 1, y: 2, width: 1, height: 1} })); }
      export function measureRegion(raster, region) { return { bandSum: 1, backgroundMean: 2, net: 10 * region.lane, warnings: region.source === 'automatic' ? ['CANDIDATES_REQUIRE_REVIEW'] : [] }; }
    `,
    'real/rolling-ball': `export function cachedRollingBallBackground() {}; export function measureRegionRollingBall() { throw new Error('not used'); }`,
  });
  const input = join(f.dir, 'bands.png');
  writeFileSync(input, 'fixture');
  return { ...f, payload: { files: [input], lanes: 2, bg: { kind: 'local' }, signal: 'dark', controlLane: 1 } };
}

test('WB crop preserves automatic-review warnings and maps image coordinates', t => {
  const f = wbFixture(t);
  const r = f.run({ ...f.payload, strip: '3,10,4,15', controlLane: 2 });
  assert.equal(r.status, 0, r.stderr);
  const image = r.data.images[0];
  assert.equal(image.controlLane, 2);
  assert.deepEqual(image.lanes.map(l => l.ratio), [0.5, 1]);
  assert.deepEqual(image.lanes[0].band, { x: 5, y: 4, width: 1, height: 1 });
  assert.ok(image.lanes.every(l => l.warnings.includes('CANDIDATES_REQUIRE_REVIEW')));
});

test('WB missing control fails instead of silently using lane one', t => {
  const f = wbFixture(t);
  const r = f.run({ ...f.payload, controlLane: 3 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Control lane not found/);
  assert.equal(r.data, undefined);
});

test('WB rejects malformed, empty and out-of-image strips', t => {
  const f = wbFixture(t);
  for (const strip of ['0,10,0', '0,10,,20', '0.5,10,0,20', '0,0,0,20', '0,10,5,5', '15,10,0,20', '0,10,0,21', '-1,10,0,20']) {
    const r = f.run({ ...f.payload, strip });
    assert.notEqual(r.status, 0, strip);
    assert.match(r.stderr, /strip/);
  }
});

function pcrFixture(t) {
  const f = fixture(t, 'pcr', {
    'core/parse': `
      export async function readInputFile(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (String(bytes) !== '80,75,255,0') throw new Error('binary input was corrupted');
        if (file.name.endsWith('.rdml')) return { kind: 'rdml', matrix: [['Sample','Target','Cq'],['C','T','20']], targetEfficiencies: { T: 93, R: 99 } };
        return { kind: 'workbook', sheetNames: ['First','Second'], wb: {} };
      }
      export function sheetToRawMatrix(wb, sheet) { if (sheet !== 'First') throw new Error('wrong worksheet'); return [['Sample','Target','Cq'],['C','T','20']]; }
    `,
    'core/sniff': `export function sniff() { return { headerRow: 0, mapping: { sample: 0, target: 1, cq: 2 }, format: 'test' }; }`,
    'core/qc': `export function computeQcFlags() { return {}; }`,
    'core/stats': `export function sd() { return 0; } export function mean() { return 0; } export function welchTTest() { return {}; }`,
    'core/analysis': `
      export function isNtcRow() { return false; }
      export function isStandardRow() { return false; }
      export function extractRows(rows) { return rows.map((r,i) => ({id:i+1,sample:r[0],target:r[1],cq:Number(r[2]),excluded:false})); }
      export function analyzeDeltaDeltaCt(rows, config) { return { refGenesUsed: config.refGenes, controlSamples: config.controlSamples, effMode: true, efficiencies: config.efficiencies ?? {}, warnings: [], ntcReport: [], results: rows }; }
    `,
  });
  for (const name of ['table.xlsx', 'table.rdml']) writeFileSync(join(f.dir, name), Buffer.from([80, 75, 255, 0]));
  return f;
}

test('PCR forwards binary files intact and reports first-sheet selection', t => {
  const f = pcrFixture(t);
  const r = f.run({ files: [join(f.dir, 'table.xlsx')], refGenes: ['R'], controlSamples: ['C'] });
  assert.equal(r.status, 0, r.stderr);
  const file = r.data.files[0];
  assert.equal(file.error, undefined);
  assert.equal(file.sheet, 'First');
  assert.equal(file.inputKind, 'workbook');
  assert.ok(file.warnings.some(warning => /Only the first worksheet/.test(warning)));
  assert.deepEqual(file.results, [{id:1,sample:'C',target:'T',cq:20,excluded:false}]);
});

test('PCR applies RDML efficiencies with explicit values taking precedence', t => {
  const f = pcrFixture(t);
  const r = f.run({ files: [join(f.dir, 'table.rdml')], refGenes: ['R'], controlSamples: ['C'], efficiencies: { T: 92 } });
  assert.equal(r.status, 0, r.stderr);
  const file = r.data.files[0];
  assert.equal(file.error, undefined);
  assert.equal(file.inputKind, 'rdml');
  assert.equal(file.sheet, null);
  assert.deepEqual(file.efficiencies, { T: 92, R: 99 });
});
