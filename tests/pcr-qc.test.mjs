import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePcrOptions, normalizeExperimentalDesign } from '../pcr-options.mjs';
import { preparePcrRows } from '../pcr-qc.mjs';
const rows = [20,20,40,10].map((cq,i) => ({id:i+1,plate:'P',well:`A${i+1}`,sample:i===3?'NTC':'S1',target:'T',cq,excluded:false}));
const api = {
  computeQcFlags: () => ({3:['above maximum'],4:['below minimum']}),
  sd: values => Math.sqrt(values.reduce((s,x)=>s+(x-values.reduce((a,b)=>a+b,0)/values.length)**2,0)/(values.length-1)),
  isNtcRow: row => row.sample==='NTC', isStandardRow: () => false,
};
test('report mode records flags and high SD without changing rows or inferring biological n', () => {
  const r=preparePcrRows(rows,{qc:{maxCq:35,repSD:1}},api);
  assert.ok(r.rows.every(row=>!row.excluded));
  assert.deepEqual(r.report.flaggedRowIds,[3,4]);
  assert.equal(r.report.replicateGroups[0].highSD,true);
  assert.equal(r.report.replication.biologicalReplicateCount,null);
  assert.equal(r.report.replication.statisticalUnit,'descriptive_only');
});

test('same sample names on different plates remain separate QC groups with older engines', () => {
  const input = [20, 20, 30, 30].map((cq, i) => ({ id: i + 1, plate: i < 2 ? 'P1' : 'P2', sample: 'S', target: 'T', cq, excluded: false }));
  const seen = [];
  const r = preparePcrRows(input, { qc: { repSD: 1 } }, { ...api, computeQcFlags(group) { seen.push(group); return {}; } });
  assert.equal(seen.length, 2);
  assert.deepEqual(r.report.replicateGroups.map(group => [group.plate, group.wellCount, group.highSD]), [['P1', 2, false], ['P2', 2, false]]);
});

test('design validation preserves identities and never invents confirmation', () => {
  assert.equal(normalizeExperimentalDesign(), undefined);
  const design = { kind: 'independent', confirmed: false, controlGroup: '', assignments: [] };
  assert.deepEqual(normalizeExperimentalDesign(design), design);
  for (const invalid of [{}, { ...design, confirmed: 'true' }, { ...design, guessed: true }, { ...design, assignments: [{ sample: 'S', group: 'C', unitId: 'U' }] }]) {
    assert.throws(() => normalizeExperimentalDesign(invalid), /experimentalDesign/);
  }
});
test('exclude mode removes flagged sample wells while retaining NTC', () => {
  const r=preparePcrRows(rows,{qcMode:'exclude',qc:{maxCq:35}},api);
  assert.deepEqual(r.report.excludedRowIds,[3]);
  assert.equal(r.rows[3].excluded,false);
  assert.equal(r.report.replicateGroups[0].retainedWellCount,2);
  assert.equal(r.report.replicateGroups[0].sdCqAfter,0);
});
test('high group SD alone does not remove every well', () => {
  const r=preparePcrRows(rows,{qcMode:'exclude',qc:{repSD:1}},{...api,computeQcFlags:()=>({})});
  assert.deepEqual(r.report.excludedRowIds,[]);
  assert.equal(r.report.replicateGroups[0].highSD,true);
});
test('manual row IDs are audited, unknown IDs and manual NTC exclusions fail', () => {
  assert.deepEqual(preparePcrRows(rows,{excludeRows:[2,2]},api).report.excludedRowIds,[2]);
  assert.throws(()=>preparePcrRows(rows,{excludeRows:[99]},api),/Unknown excluded/);
  assert.throws(()=>preparePcrRows(rows,{excludeRows:[4]},api),/NTC row/);
});
test('thresholds are JSON safe, explicit zero Cq is valid, invalid ranges and IDs fail', () => {
  assert.equal(normalizePcrOptions({qc:{minCq:0}}).qc.minCq,0);
  for(const options of [{qc:{minCq:30,maxCq:20}},{qc:{absDev:0}},{qc:{repSD:-1}},{qc:{zScore:NaN}},{qc:{unknown:2}},{qcMode:'typo'},{excludeRows:[0]}]) {
    assert.throws(()=>normalizePcrOptions(options));
  }
  assert.ok(!JSON.stringify(normalizePcrOptions()).includes('NaN'));
});
