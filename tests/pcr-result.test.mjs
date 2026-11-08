import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePcrResult } from '../pcr-result.mjs';

const design = { kind: 'independent', confirmed: true, controlGroup: 'Control', assignments: [] };
const sample = { sample: 'T1', plate: 'P', sampleIds: [{ plate: 'P', sample: 'T1' }], unitId: 'U1', n: 3, nBio: 1, pValue: 0.001, pAdjusted: 0.002, significance: '**', statMethod: 'Welch t', foldChange: 2 };
const group = { target: 'T', group: 'Treatment', nBio: 3, nTech: 9, pValue: 0.02, pAdjusted: null, anovaPValue: null };
const modern = { results: [sample], groupResults: [group], designStatus: 'confirmed', designIssues: [] };

test('old engines retain descriptive values but cannot expose legacy inference', () => {
  const out = normalizePcrResult({ results: [sample], groupResults: [group] }, design);
  assert.equal(out.designStatus, 'unsupported');
  assert.equal(out.designIssues[0].code, 'ENGINE_DESIGN_UNSUPPORTED');
  assert.equal(out.inferenceMode, 'descriptive_only');
  assert.deepEqual(out.groupResults, []);
  assert.equal(out.results[0].foldChange, 2);
  assert.equal(out.results[0].nTech, 3);
  assert.equal(out.results[0].nBio, null);
  assert.equal(out.results[0].pValue, null);
  assert.equal(out.results[0].pAdjusted, null);
  assert.equal(out.results[0].significance, '');
  assert.equal(out.results[0].statMethod, 'descriptive_only');
  assert.equal(out.replication.statisticalUnit, 'descriptive_only');
  assert.equal(out.replication.aggregationUnit, 'legacy-engine-defined');
});

test('confirmed modern engines keep only unit-level group inference and per-target counts', () => {
  const out = normalizePcrResult(modern, design);
  assert.deepEqual(out.groupResults, [group]);
  assert.equal(out.results[0].pValue, null);
  assert.equal(out.results[0].nBio, 1);
  assert.equal(out.inferenceMode, 'independent_units');
  assert.equal(out.replication.biologicalReplicateCount, null);
  assert.equal(out.replication.aggregationUnit, 'experimental-unit-target');
  assert.deepEqual(out.replication.byTargetGroup, [{ target: 'T', group: 'Treatment', nBio: 3, nTech: 9 }]);
});

test('engine confirmation cannot override an absent, unconfirmed or unsupported user design', () => {
  for (const request of [undefined, { ...design, confirmed: false }, { ...design, kind: 'paired' }]) {
    const out = normalizePcrResult(modern, request);
    assert.equal(out.designStatus, 'invalid');
    assert.equal(out.inferenceMode, 'descriptive_only');
    assert.deepEqual(out.groupResults, []);
  }
  for (const status of ['unconfirmed', 'invalid', 'unsupported']) {
    assert.deepEqual(normalizePcrResult({ ...modern, designStatus: status }, design).groupResults, []);
  }
});

test('a confirmed design with insufficient units does not claim an executed inference', () => {
  const out = normalizePcrResult({ ...modern, groupResults: [{ ...group, nBio: 1, pValue: null }] }, design);
  assert.equal(out.designStatus, 'confirmed');
  assert.equal(out.inferenceMode, 'descriptive_only');
  assert.equal(out.replication.statisticalUnit, 'experimental_unit');
});
