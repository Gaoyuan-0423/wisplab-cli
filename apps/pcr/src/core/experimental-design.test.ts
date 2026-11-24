import { describe, expect, it } from 'vitest';
import { analyzeDeltaDeltaCt, type AnalysisRow } from './analysis';
import { analyzeAuto, buildQualityReport } from './auto';
import { computeQcFlags } from './qc';
import { dunnettAdjustedP, oneWayAnova, welchTTest } from './stats';
import { DEFAULT_QC, type AnalysisConfig, type ExperimentalUnitAssignment } from './types';

interface UnitFixture { sample: string; group: string; delta: number; plate?: string; unitId?: string; nTech?: number }
function fixture(units: UnitFixture[]) {
  const rows: AnalysisRow[] = [];
  const assignments: ExperimentalUnitAssignment[] = [];
  for (const unit of units) {
    const { sample, group, delta, plate = 'P1', unitId = sample, nTech = 3 } = unit;
    assignments.push({ plate, sample, unitId, group });
    for (let rep = 0; rep < nTech; rep++) {
      const offset = nTech === 1 ? 0 : (rep - (nTech - 1) / 2) * 0.05;
      for (const [target, cq] of [['REF', 20], ['TARGET', 20 + delta + offset]] as const) {
        rows.push({ id: rows.length + 1, plate, sample, group, target, cq, well: `A${rows.length + 1}`, task: '', pairId: '', quantity: NaN, excluded: false });
      }
    }
  }
  const config: AnalysisConfig = {
    controlSamples: [], refGenes: ['REF'], qc: DEFAULT_QC,
    experimentalDesign: { kind: 'independent', confirmed: true, controlGroup: 'Control', assignments },
  };
  return { rows, config };
}
const twoGroups: UnitFixture[] = [
  { sample: 'C1', group: 'Control', delta: 4 },
  { sample: 'C2', group: 'Control', delta: 5 },
  { sample: 'C3', group: 'Control', delta: 7 },
  { sample: 'T1', group: 'Treatment', delta: 1 },
  { sample: 'T2', group: 'Treatment', delta: 2 },
  { sample: 'T3', group: 'Treatment', delta: 3 },
];

describe('confirmed units preserve individual reference efficiencies', () => {
  it('uses equal control-unit weights with unequal technical counts and optional references', () => {
    const rows: AnalysisRow[] = [];
    const assignments: ExperimentalUnitAssignment[] = [];
    for (const [sample, group, r1, r2, target, repeats] of [
      ['C1', 'Control', 20, 30, 25, 1],
      ['C2', 'Control', 22, 28, 27, 9],
      ['T1', 'Treatment', 30, 20, 25, 3],
      ['T2', 'Treatment', 29, 21, 24, 2],
    ] as const) {
      assignments.push({ plate: 'P', sample, unitId: sample, group });
      for (const [gene, cq] of [['R1', r1], ['R2', r2], ['TARGET', target]] as const) {
        for (let rep = 0; rep < repeats; rep++) rows.push({ id: rows.length + 1,
          plate: 'P', sample, group, target: gene, cq, well: String(rows.length + 1),
          task: '', pairId: '', quantity: NaN, excluded: false });
      }
    }
    const config: AnalysisConfig = { controlSamples: [], refGenes: ['R1', 'R2'], qc: DEFAULT_QC,
      efficiencies: { R1: 90, R2: 110, TARGET: 95 },
      experimentalDesign: { kind: 'independent', confirmed: true, controlGroup: 'Control', assignments } };
    const output = analyzeDeltaDeltaCt(rows, config);
    // Independent quantity-domain calculation: control means are TARGET=26,
    // R1=21, R2=29 despite C2 having nine times as many technical wells.
    const t1 = 1.95 / Math.sqrt(Math.pow(1.9, -9) * Math.pow(2.1, 9));
    const t2 = Math.pow(1.95, 2) / Math.sqrt(Math.pow(1.9, -8) * Math.pow(2.1, 8));
    expect(output.results.find((r) => r.unitId === 'T1')!.foldChange).toBeCloseTo(t1, 12);
    expect(output.results.find((r) => r.unitId === 'T2')!.foldChange).toBeCloseTo(t2, 12);
    const treatment = output.groupResults.find((r) => !r.isControl)!;
    expect(treatment.nBio).toBe(2);
    expect(treatment.fcMean).toBeCloseTo((t1 + t2) / 2, 12);
    expect(treatment.foldChange).toBeCloseTo(Math.sqrt(t1 * t2), 12);
    const copies = rows.filter((r) => r.sample === 'C2').map((r, i) => ({ ...r, id: 1000 + i }));
    const repeated = analyzeDeltaDeltaCt([...rows, ...copies], config);
    const repeatTreatment = repeated.groupResults.find((r) => !r.isControl)!;
    expect(repeatTreatment.fcMean).toBeCloseTo(treatment.fcMean, 12);
    expect(repeatTreatment.pValue).toBeCloseTo(treatment.pValue!, 12);
    const reversed = analyzeDeltaDeltaCt(rows, { ...config, refGenes: ['R2', 'R1'] });
    expect(reversed.results.map((r) => r.foldChange)).toEqual(output.results.map((r) => r.foldChange));
  });
});

describe('explicit experimental units and biological inference', () => {
  it('3 units × 3 wells become nBio=3/nTech=9 and Welch uses three unit means', () => {
    const { rows, config } = fixture(twoGroups);
    const out = analyzeDeltaDeltaCt(rows, config);
    const treatment = out.groupResults.find((g) => !g.isControl)!;
    expect(out.designStatus).toBe('confirmed');
    expect(out.controlSamples).toEqual(['C1', 'C2', 'C3']);
    expect(treatment.nBio).toBe(3);
    expect(treatment.nTech).toBe(9);
    expect(treatment.deltaCtValues).toEqual([1, 2, 3]);
    expect(treatment.pValue).toBeCloseTo(welchTTest([1, 2, 3], [4, 5, 7]).p, 12);
    expect(treatment.pAdjusted).toBeNull();
    expect(out.results.every((r) => r.nBio === 1 && r.nTech === 3 && r.pValue === null && r.pAdjusted === null)).toBe(true);
  });

  it('one unit with three technical wells per group has no biological p value', () => {
    const { rows, config } = fixture([twoGroups[0], twoGroups[3]]);
    const out = analyzeDeltaDeltaCt(rows, config);
    expect(out.groupResults.map((g) => g.nBio)).toEqual([1, 1]);
    expect(out.groupResults.every((g) => g.pValue === null && g.pAdjusted === null && g.anovaPValue === null && g.significance === '')).toBe(true);
    expect(out.designIssues.some((i) => i.code === 'INSUFFICIENT_BIOLOGICAL_REPLICATION')).toBe(true);
  });

  it('copying all technical measurements of one unit changes neither biological n nor its weight', () => {
    const { rows, config } = fixture(twoGroups);
    const original = analyzeDeltaDeltaCt(rows, config);
    const copies = rows.filter((r) => r.sample === 'C1').map((r, i) => ({ ...r, id: 1000 + i, well: `B${i + 1}` }));
    const duplicated = analyzeDeltaDeltaCt([...rows, ...copies], config);
    const getTreatment = (out: typeof original) => out.groupResults.find((g) => !g.isControl)!;
    expect(getTreatment(duplicated).nBio).toBe(3);
    expect(duplicated.groupResults.find((g) => g.isControl)!.nTech).toBe(12);
    expect(getTreatment(duplicated).pValue).toBeCloseTo(getTreatment(original).pValue!, 12);
    expect(getTreatment(duplicated).ddCt).toBeCloseTo(getTreatment(original).ddCt!, 12);
  });

  it('unequal technical counts leave Livak and Pfaffl control units equally weighted', () => {
    const { rows, config } = fixture([
      { sample: 'C1', group: 'Control', delta: 5, nTech: 1 },
      { sample: 'C2', group: 'Control', delta: 7, nTech: 9 },
      { sample: 'T1', group: 'Treatment', delta: 4 },
    ]);
    const livak = analyzeDeltaDeltaCt(rows, config).results.find((r) => !r.isControl)!;
    expect(livak.ddCt).toBeCloseTo(-2, 12);
    expect(livak.foldChange).toBeCloseTo(4, 12);
    const pfaffl = analyzeDeltaDeltaCt(rows, { ...config, efficiencies: { TARGET: 200 } }).results.find((r) => !r.isControl)!;
    expect(pfaffl.foldChange).toBeCloseTo(9, 12);
  });

  it('unconfirmed and incomplete mappings remain descriptive', () => {
    const { rows, config } = fixture(twoGroups);
    const unconfirmed = analyzeDeltaDeltaCt(rows, { ...config, controlSamples: ['C1'], experimentalDesign: { ...config.experimentalDesign!, confirmed: false } });
    expect(unconfirmed.designStatus).toBe('unconfirmed');
    expect(unconfirmed.groupResults).toEqual([]);
    expect(unconfirmed.results.every((r) => r.nBio === null && r.pValue === null)).toBe(true);
    const incomplete = analyzeDeltaDeltaCt(rows, { ...config, experimentalDesign: { ...config.experimentalDesign!, assignments: config.experimentalDesign!.assignments.slice(1) } });
    expect(incomplete.designStatus).toBe('invalid');
    expect(incomplete.designIssues.some((i) => i.code === 'ASSIGNMENT_MISSING')).toBe(true);
    expect(incomplete.groupResults).toEqual([]);
  });

  it('a unit mapped to conflicting independent groups is not silently merged', () => {
    const { rows, config } = fixture([twoGroups[0], { ...twoGroups[3], unitId: 'C1' }]);
    const out = analyzeDeltaDeltaCt(rows, config);
    expect(out.designStatus).toBe('invalid');
    expect(out.designIssues.some((i) => i.code === 'UNIT_GROUP_CONFLICT')).toBe(true);
    expect(out.results).toHaveLength(2);
    expect(out.groupResults).toEqual([]);
  });

  it('duplicate raw identity assignments and conflicting raw groups are explicit errors', () => {
    const { rows, config } = fixture(twoGroups);
    config.experimentalDesign!.assignments.push({ ...config.experimentalDesign!.assignments[0], unitId: 'another' });
    expect(analyzeDeltaDeltaCt(rows, config).designIssues.some((i) => i.code === 'ASSIGNMENT_CONFLICT')).toBe(true);
    config.experimentalDesign!.assignments.pop();
    rows[0].group = 'other group';
    const out = analyzeDeltaDeltaCt(rows, config);
    expect(out.designStatus).toBe('invalid');
    expect(out.designIssues.some((i) => i.code === 'SOURCE_GROUP_CONFLICT')).toBe(true);
  });

  it('same sample names on different plates stay distinct unless explicitly mapped together', () => {
    const { rows, config } = fixture([
      { sample: 'same', plate: 'P1', unitId: 'C1', group: 'Control', delta: 4 },
      { sample: 'same', plate: 'P2', unitId: 'C2', group: 'Control', delta: 6 },
      { sample: 'T1', plate: 'P1', group: 'Treatment', delta: 2 },
      { sample: 'T2', plate: 'P2', group: 'Treatment', delta: 3 },
    ]);
    const separate = analyzeDeltaDeltaCt(rows, config);
    expect(separate.groupResults.find((g) => g.isControl)!.nBio).toBe(2);
    expect(separate.results.filter((r) => r.sample === 'same')).toHaveLength(2);
    config.experimentalDesign!.assignments[1].unitId = 'C1';
    const merged = analyzeDeltaDeltaCt(rows, config);
    expect(merged.groupResults.find((g) => g.isControl)!.nBio).toBe(1);
    const control = merged.results.find((r) => r.isControl)!;
    expect(control.nTech).toBe(6);
    expect(control.sampleIds).toEqual([{ plate: 'P1', sample: 'same' }, { plate: 'P2', sample: 'same' }]);
    expect(control.deltaCt).toBeCloseTo(5, 12);
    expect(merged.groupResults.every((g) => g.pValue === null)).toBe(true);
    const legacy = analyzeDeltaDeltaCt(rows, { ...config, experimentalDesign: undefined, controlSamples: ['same'] });
    expect(legacy.results.filter((r) => r.sample === 'same')).toHaveLength(2);
  });

  it.each(['paired', 'repeated'] as const)('%s units across conditions are valid but unsupported for inference', (kind) => {
    const { rows, config } = fixture([twoGroups[0], { ...twoGroups[3], unitId: 'C1' }]);
    config.experimentalDesign!.kind = kind;
    const out = analyzeDeltaDeltaCt(rows, config);
    expect(out.designStatus).toBe('unsupported');
    expect(out.designIssues.some((i) => i.code === 'UNIT_GROUP_CONFLICT')).toBe(false);
    expect(out.designIssues.some((i) => i.code === 'DESIGN_UNSUPPORTED')).toBe(true);
    expect(out.results).toHaveLength(2);
    expect(out.groupResults).toEqual([]);
  });

  it.each(['paired', 'repeated'] as const)('selecting an unconfirmed %s design explicitly reports unsupported', (kind) => {
    const { rows, config } = fixture(twoGroups);
    config.experimentalDesign = { kind, confirmed: false, controlGroup: '', assignments: [] };
    const out = analyzeDeltaDeltaCt(rows, config);
    expect(out.designStatus).toBe('unsupported');
    expect(out.designIssues.map((i) => i.code)).toEqual(['DESIGN_UNSUPPORTED']);
    expect(out.groupResults).toEqual([]);
    expect(out.results.every((r) => r.nBio === null && r.pValue === null)).toBe(true);
  });

  it('multi-group ANOVA includes control units and Dunnett uses the same pooled variance', () => {
    const { rows, config } = fixture([...twoGroups,
      { sample: 'U1', group: 'Treatment2', delta: 0 },
      { sample: 'U2', group: 'Treatment2', delta: 1 },
      { sample: 'U3', group: 'Treatment2', delta: 2 },
    ]);
    const out = analyzeDeltaDeltaCt(rows, config);
    const reference = oneWayAnova([[4, 5, 7], [1, 2, 3], [0, 1, 2]]);
    const expectedAdjusted = dunnettAdjustedP([2, 1].map((m) => ({ b: 1, tAbs: Math.abs((m - 16 / 3) / (Math.sqrt(reference.msWithin) * Math.sqrt(2 / 3))) })), 6);
    expect(out.groupResults).toHaveLength(3);
    for (const group of out.groupResults) {
      expect(group.anovaPValue).toBeCloseTo(reference.p, 12);
      expect(group.pValue).toBeNull();
    }
    expect(out.groupResults[0].pAdjusted).toBeNull();
    expect(out.groupResults[1].statMethod).toContain('df=2/6');
    expect(out.groupResults[1].pAdjusted).toBeCloseTo(expectedAdjusted[0], 12);
    expect(out.groupResults[2].pAdjusted).toBeCloseTo(expectedAdjusted[1], 12);
  });

  it('confirmed units need every selected reference gene before entering biological inference', () => {
    const { rows, config } = fixture(twoGroups);
    config.refGenes.push('REF2');
    const secondReference = rows.filter((r) => r.target === 'REF' && r.sample !== 'C1').map((r, i) => ({ ...r, id: 1000 + i, target: 'REF2', cq: 18 }));
    const out = analyzeDeltaDeltaCt([...rows, ...secondReference], config);
    const incomplete = out.results.find((r) => r.unitId === 'C1')!;
    expect(incomplete.meanCq).toBeCloseTo(24);
    expect(incomplete.deltaCt).toBeNull();
    expect(out.groupResults.find((g) => g.isControl)!.nBio).toBe(2);
    expect(out.designIssues.find((i) => i.code === 'REFERENCE_INCOMPLETE')?.unitId).toBe('C1');
    const globallyMissing = analyzeDeltaDeltaCt(rows, config);
    expect(globallyMissing.groupResults.every((g) => g.nBio === 0 && g.pValue === null)).toBe(true);
  });

  it('a group lacking all target measurements is retained and cannot silently disappear from ANOVA', () => {
    const { rows, config } = fixture([...twoGroups, { sample: 'U1', group: 'Treatment2', delta: 0 }]);
    for (const row of rows) if (row.sample === 'U1' && row.target === 'TARGET') row.cq = NaN;
    const out = analyzeDeltaDeltaCt(rows, config);
    expect(out.groupResults).toHaveLength(3);
    expect(out.groupResults.find((g) => g.group === 'Treatment2')!.nBio).toBe(0);
    expect(out.groupResults.every((g) => g.pValue === null && g.anovaPValue === null && g.pAdjusted === null)).toBe(true);
  });

  it('raw pair IDs linking distinct units across conditions block independent inference', () => {
    const { rows, config } = fixture(twoGroups);
    for (const row of rows) if (row.sample === 'C1' || row.sample === 'T1') row.pairId = 'subject-1';
    const out = analyzeDeltaDeltaCt(rows, config);
    expect(out.designStatus).toBe('invalid');
    expect(out.designIssues.some((i) => i.code === 'PAIR_ID_DEPENDENCE')).toBe(true);
    expect(out.groupResults).toEqual([]);
  });

  it('pair IDs repeated only within one group are not automatically treated as cross-condition dependence', () => {
    const { rows, config } = fixture(twoGroups);
    for (const row of rows) if (row.group === 'Control') row.pairId = 'batch-like-label';
    const out = analyzeDeltaDeltaCt(rows, config);
    expect(out.designStatus).toBe('confirmed');
    expect(out.designIssues.some((i) => i.code === 'PAIR_ID_DEPENDENCE')).toBe(false);
    expect(out.groupResults.find((g) => !g.isControl)!.pValue).not.toBeNull();
  });
});

describe('automatic analysis preserves experimental-design boundary', () => {
  it('explicit group assignments enable analysis even when automatic names suggest no controls', () => {
    const { rows, config } = fixture(twoGroups);
    const matrix = [['Plate', 'Sample', 'Target', 'Cq'], ...rows.map((r) => [r.plate, r.sample, r.target === 'REF' ? 'GAPDH' : r.target, String(r.cq)])];
    const result = analyzeAuto(matrix, { experimentalDesign: config.experimentalDesign });
    expect(result.guess.controlSamples).toEqual([]);
    expect(result.output.designStatus).toBe('confirmed');
    expect(result.output.groupResults.find((g) => !g.isControl)!.pValue).not.toBeNull();
    expect(result.report.issues.some((i) => i.code === 'NO_CONTROL')).toBe(false);
  });

  it('automatic names do not confirm biological independence', () => {
    const matrix = [['Sample', 'Target', 'Cq'], ['Control-1', 'GAPDH', '20'], ['Control-1', 'LDHA', '25'], ['Treat-1', 'GAPDH', '20'], ['Treat-1', 'LDHA', '23']];
    const result = analyzeAuto(matrix);
    expect(result.output.designStatus).toBe('unconfirmed');
    expect(result.output.groupResults).toEqual([]);
    expect(result.report.issues.some((i) => i.code === 'DESIGN_UNCONFIRMED')).toBe(true);
    expect(result.report.issues.some((i) => i.code === 'CONTROL_SMALL')).toBe(false);
  });

  it('quality reports count biological units rather than technical wells or genes', () => {
    const { rows, config } = fixture([{ ...twoGroups[0], nTech: 9 }, { ...twoGroups[3], nTech: 9 }]);
    const output = analyzeDeltaDeltaCt(rows, config);
    const report = buildQualityReport({ rows, flags: {}, output, guess: { controlSamples: [], refGenes: ['REF'], basis: '' }, mappingComplete: true, headerRow: 0 });
    expect(report.issues.some((i) => i.code === 'NO_CONTROL')).toBe(false);
    expect(report.issues.find((i) => i.code === 'CONTROL_SMALL')?.message).toContain('仅 1');
    expect(report.advice.some((a) => a.code === 'BIO_REPLICATE')).toBe(true);
  });
});

describe('technical QC preserves raw plate identity', () => {
  it('same names on distinct plates do not create false technical outliers', () => {
    const { rows } = fixture([
      { sample: 'same', plate: 'P1', group: 'Control', delta: 4 },
      { sample: 'same', plate: 'P2', group: 'Treatment', delta: 10 },
    ]);
    const flags = computeQcFlags(rows, { ...DEFAULT_QC, absDev: 1 });
    expect(flags).toEqual({});
    const bad = rows.find((r) => r.plate === 'P2' && r.target === 'TARGET')!;
    bad.cq = 40;
    const flagged = computeQcFlags(rows, { ...DEFAULT_QC, absDev: 1 });
    expect(flagged[bad.id]).toBeDefined();
    expect(rows.filter((r) => r.plate === 'P1').every((r) => flagged[r.id] === undefined)).toBe(true);
  });
});
