import { describe, expect, it } from 'vitest';
import {
  analyzeDeltaDeltaCt,
  extractRows,
  isNtcRow,
  NTC_CONTAMINATION_CQ,
} from './analysis';
import { DEFAULT_QC, emptyMapping } from './types';

describe('NTC 识别', () => {
  it('Task 列与样本名两种途径', () => {
    expect(isNtcRow({ sample: 'WT-1', task: 'NTC' })).toBe(true);
    expect(isNtcRow({ sample: 'WT-1', task: 'ntc' })).toBe(true);
    expect(isNtcRow({ sample: 'NTC', task: '' })).toBe(true);
    expect(isNtcRow({ sample: 'NTC-2', task: '' })).toBe(true);
    expect(isNtcRow({ sample: 'NTC 1', task: 'Unknown' })).toBe(true);
    expect(isNtcRow({ sample: 'myNTC', task: '' })).toBe(false);
    expect(isNtcRow({ sample: 'NTCx', task: '' })).toBe(false);
    expect(isNtcRow({ sample: 'Treat-1', task: 'Unknown' })).toBe(false);
  });
});

function buildRows(data: (string | number)[][]) {
  return extractRows(
    data.map((r) => r.map(String)),
    { ...emptyMapping(), sample: 0, target: 1, cq: 2 },
  );
}

describe('NTC 污染报告', () => {
  const base = [
    ['C1', 'GAPDH', 20], ['C1', 'GAPDH', 20],
    ['T1', 'GAPDH', 20], ['T1', 'GAPDH', 20],
    ['C1', 'LDHA', 25], ['C1', 'LDHA', 25], ['C1', 'LDHA', 25],
    ['T1', 'LDHA', 23], ['T1', 'LDHA', 23], ['T1', 'LDHA', 23],
  ];

  it('NTC 行不进入样本与结果；内参与目标基因都有报告', () => {
    const rows = buildRows([
      ...base,
      ['NTC', 'GAPDH', ''],
      ['NTC', 'LDHA', '33.10'],
      ['NTC-2', 'LDHA', '38.40'],
    ]);
    const out = analyzeDeltaDeltaCt(rows, {
      controlSamples: ['C1'],
      refGenes: ['GAPDH'],
      qc: DEFAULT_QC,
    });
    expect(out.results.map((r) => r.sample).sort()).toEqual(['C1', 'T1']);
    expect(out.results).toHaveLength(2);

    const gapdh = out.ntcReport.find((e) => e.target === 'GAPDH')!;
    expect(gapdh.verdict).toBe('pass');
    expect(gapdh.amplified).toBe(0);

    const ldha = out.ntcReport.find((e) => e.target === 'LDHA')!;
    expect(ldha.verdict).toBe('contaminated');
    expect(ldha.minCq).toBeCloseTo(33.1);
    expect(ldha.amplified).toBe(2);

    expect(out.warnings.some((w) => w.includes('LDHA') && w.includes('污染'))).toBe(true);
  });

  it(`晚期扩增（Cq ≥ ${NTC_CONTAMINATION_CQ}）单独归档`, () => {
    const rows = buildRows([...base, ['NTC', 'LDHA', '38.40']]);
    const out = analyzeDeltaDeltaCt(rows, {
      controlSamples: ['C1'],
      refGenes: ['GAPDH'],
      qc: DEFAULT_QC,
    });
    const ldha = out.ntcReport.find((e) => e.target === 'LDHA')!;
    expect(ldha.verdict).toBe('late');
    expect(ldha.minCq).toBeCloseTo(38.4);
    expect(out.warnings.some((w) => w.includes('晚期扩增'))).toBe(true);
    expect(out.warnings.some((w) => w.includes('疑似'))).toBe(false);
  });

  it('无 NTC 时报告为空、无警告', () => {
    const out = analyzeDeltaDeltaCt(buildRows(base), {
      controlSamples: ['C1'],
      refGenes: ['GAPDH'],
      qc: DEFAULT_QC,
    });
    expect(out.ntcReport).toHaveLength(0);
  });
});
