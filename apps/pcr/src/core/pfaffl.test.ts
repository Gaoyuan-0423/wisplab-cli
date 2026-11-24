import { describe, expect, it } from 'vitest';
import { analyzeDeltaDeltaCt, extractRows } from './analysis';
import { DEFAULT_QC, emptyMapping } from './types';

// 手算基准：GAPDH 内参（效率 100%，E=2），LDHA 目标（效率 200%，E=3）
// 对照 C1：GAPDH 20,20；LDHA 20,20 —— Ct_T,对照均值=20，Ct_R,对照均值=20
// 处理 T1：GAPDH 20,20；LDHA 19,19
// Pfaffl：FC = 3^(20−19) / 2^(20−20) = 3；Livak 会给 2^1 = 2
function buildRows(data: (string | number)[][]) {
  return extractRows(data.map((r) => r.map(String)), {
    ...emptyMapping(),
    sample: 0,
    target: 1,
    cq: 2,
  });
}
const DATA = [
  ['C1', 'GAPDH', 20], ['C1', 'GAPDH', 20],
  ['T1', 'GAPDH', 20], ['T1', 'GAPDH', 20],
  ['C1', 'LDHA', 20], ['C1', 'LDHA', 20],
  ['T1', 'LDHA', 19], ['T1', 'LDHA', 19],
];
const base = { controlSamples: ['C1'], refGenes: ['GAPDH'], qc: DEFAULT_QC };

describe('Pfaffl 效率校正', () => {
  it('手算对照：目标 E=200% 时 FC = 3（Livak 会给 2）', () => {
    const rows = buildRows(DATA);
    const out = analyzeDeltaDeltaCt(rows, { ...base, efficiencies: { LDHA: 200 } });
    expect(out.effMode).toBe(true);
    const t1 = out.results.find((r) => r.sample === 'T1')!;
    expect(t1.foldChange).toBeCloseTo(3, 8);
    expect(t1.fcValues.every((v) => Math.abs(v - 3) < 1e-9)).toBe(true);
    expect(t1.statMethod).toContain('Pfaffl');
    const c1 = out.results.find((r) => r.isControl)!;
    expect(c1.foldChange).toBeCloseTo(1, 8);
  });

  it('全部 100% 时严格退化为 Livak', () => {
    const rows = buildRows(DATA);
    const out = analyzeDeltaDeltaCt(rows, base);
    expect(out.effMode).toBe(false);
    const t1 = out.results.find((r) => r.sample === 'T1')!;
    expect(t1.foldChange).toBeCloseTo(2, 8);
    expect(t1.statMethod).not.toContain('Pfaffl');
  });

  it('内参效率参与校正：E 换算为 1+pct/100（150% → E=2.5）', () => {
    // 参照指数 = Ct_R,对照均值 − refCq = 20 − 20 = 0 → E_R 不影响该数据；FC = 2^1 / E_R^0 = 2
    const rows = buildRows(DATA);
    const out = analyzeDeltaDeltaCt(rows, { ...base, efficiencies: { GAPDH: 150 } });
    expect(out.effMode).toBe(true);
    const t1 = out.results.find((r) => r.sample === 'T1')!;
    expect(t1.foldChange).toBeCloseTo(2, 8);
  });

  it('组合效率 + 参照指数非零：FC = 3^1 / 2.5^0.5', () => {
    // T1 的 GAPDH 20,20,19,19 → refCq=19.5，参照指数 = 20 − 19.5 = 0.5；E_R = 1+150/100 = 2.5
    const rows = buildRows([
      ...DATA,
      ['T1', 'GAPDH', 19], ['T1', 'GAPDH', 19],
    ]);
    const out = analyzeDeltaDeltaCt(rows, { ...base, efficiencies: { LDHA: 200, GAPDH: 150 } });
    const t1 = out.results.find((r) => r.sample === 'T1')!;
    expect(t1.foldChange).toBeCloseTo(3 / Math.sqrt(2.5), 8);
  });

  it('配置缺省时等价于全部 100%', () => {
    const rows = buildRows(DATA);
    const a = analyzeDeltaDeltaCt(rows, base);
    const b = analyzeDeltaDeltaCt(rows, { ...base, efficiencies: { GAPDH: 100, LDHA: 100 } });
    expect(b.effMode).toBe(false);
    expect(a.results.map((r) => r.foldChange)).toEqual(b.results.map((r) => r.foldChange));
  });
});

describe('optional multiple references retain their individual efficiencies', () => {
  // Independent R 4.5.3 quantity-domain oracle, qBase generalized model:
  // 1 / sqrt(1.9^(-10) * 2.1^10) = 0.60627761164574501.
  // https://pmc.ncbi.nlm.nih.gov/articles/PMC1852402/ (normalized relative quantities).
  const data: (string | number)[][] = [
    ['C1','R1',20],['C1','R1',20],['C1','R1',20],['C1','R2',30],
    ['C1','T',25],['C1','T',25],
    ['S1','R1',30],['S1','R2',20],['S1','R2',20],['S1','R2',20],
    ['S1','T',25],['S1','T',25],
  ];
  const config = {controlSamples:['C1'],refGenes:['R1','R2'],qc:DEFAULT_QC};
  it('does not cancel 90% and 110% reference efficiencies into a false Livak result', () => {
    const efficiencies = {R1:90,R2:110,T:100};
    const out = analyzeDeltaDeltaCt(buildRows(data), {...config,efficiencies});
    const treatment = out.results.find(row => row.sample === 'S1')!;
    expect(out.effMode).toBe(true);
    expect(treatment.foldChange).toBeCloseTo(0.60627761164574501,12);
    expect(treatment.fcValues).toHaveLength(2);
    treatment.fcValues.forEach(value => expect(value).toBeCloseTo(0.60627761164574501,12));
    expect(treatment.refCq).toBe(25); // Raw ΔCt summaries and tests retain their prior meaning.
    expect(treatment.statMethod).toContain('Pfaffl');
    const reverse = analyzeDeltaDeltaCt(buildRows(data), {...config,refGenes:['R2','R1'],efficiencies});
    expect(reverse.results).toEqual(out.results);
  });
  it('preserves per-well target aggregation after reference normalization', () => {
    const varied = data.filter(row => !(row[0] === 'S1' && row[1] === 'T'));
    varied.push(['S1','T',23.9],['S1','T',24],['S1','T',24.1]);
    const out = analyzeDeltaDeltaCt(buildRows(varied), {...config,efficiencies:{T:95,R1:90,R2:110}});
    // R: mean(1.95^(25-c(23.9,24,24.1))/sqrt(1.9^(-10)*2.1^10)).
    expect(out.results.find(row => row.sample === 'S1')!.foldChange).toBeCloseTo(1.1839995793479463,12);
  });
  it('keeps optional equal-efficiency references and all-100% Livak results unchanged', () => {
    const rows = buildRows(data);
    const plain = analyzeDeltaDeltaCt(rows,config);
    const all100 = analyzeDeltaDeltaCt(rows,{...config,efficiencies:{R1:100,R2:100,T:100}});
    expect(all100.results).toEqual(plain.results);
    expect(all100.effMode).toBe(false);
    const equal = analyzeDeltaDeltaCt(rows,{...config,efficiencies:{R1:90,R2:90,T:95}});
    expect(equal.results.find(row => row.sample === 'S1')!.foldChange).toBeCloseTo(1,12);
  });
});
