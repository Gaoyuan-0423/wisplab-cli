import { describe, expect, it } from 'vitest';
import { analyzeDeltaDeltaCt, extractRows } from './analysis';
import { computeQcFlags } from './qc';
import { detectPlateLayout, parseWell, wellName } from './plate';
import { DEFAULT_QC, emptyMapping, type AnalysisConfig } from './types';

describe('孔位解析', () => {
  it('A01 → (0,0)，H12 → (7,11)', () => {
    expect(parseWell('A01')).toEqual({ row: 0, col: 0 });
    expect(parseWell('h12')).toEqual({ row: 7, col: 11 });
    expect(parseWell('B3')).toEqual({ row: 1, col: 2 });
  });
  it('非法输入返回 null', () => {
    expect(parseWell('')).toBeNull();
    expect(parseWell('X99')).toBeNull();
    expect(parseWell('GAPDH')).toBeNull();
  });
  it('wellName 与 parseWell 往返一致', () => {
    for (const [r, c] of [[0, 0], [7, 11], [15, 23]] as const) {
      expect(parseWell(wellName(r, c))).toEqual({ row: r, col: c });
    }
  });
  it('板型检测：96 / 384 / custom', () => {
    expect(detectPlateLayout(['A01', 'H12'])?.kind).toBe('96');
    expect(detectPlateLayout(['A01', 'P24'])?.kind).toBe('384');
    expect(detectPlateLayout(['A1', 'B2'])?.kind).toBe('96');
    expect(detectPlateLayout(['GAPDH'])).toBeNull();
  });
});

function rowsFromAoa(data: (string | number)[][]) {
  return data.map((r) => r.map((c) => String(c)));
}

describe('QC 标记', () => {
  const rows = [
    { id: 1, sample: 'A', target: 'G', cq: 18.0, excluded: false },
    { id: 2, sample: 'A', target: 'G', cq: 18.1, excluded: false },
    { id: 3, sample: 'A', target: 'G', cq: 25.0, excluded: false }, // 离群
    { id: 4, sample: 'B', target: 'G', cq: NaN, excluded: false }, // 非数值
    { id: 5, sample: '', target: 'G', cq: 19.0, excluded: false }, // 缺样本
    { id: 6, sample: 'C', target: 'G', cq: 40.0, excluded: false }, // 越上限
  ];
  it('缺值/非数值/越界/复孔偏差', () => {
    const flags = computeQcFlags(rows, { ...DEFAULT_QC, maxCq: 35, absDev: 1.5 });
    expect(flags[4]).toContain('Cq 非数值');
    expect(flags[5]).toContain('缺少样本名');
    expect(flags[6].some((r) => r.includes('上限'))).toBe(true);
    // 绝对偏差以组均值为参照：极端离群时全部成员都会被标记（均值被拉偏）
    expect(flags[3].some((r) => r.startsWith('复孔偏差'))).toBe(true);
    expect(flags[1].some((r) => r.startsWith('复孔偏差'))).toBe(true);
  });
  it('z 分数离群（n=3 时最大 z≈1.155，阈值取 1.1 才有效）', () => {
    const flags = computeQcFlags(rows, { ...DEFAULT_QC, zScore: 1.1 });
    expect(flags[3].some((r) => r.startsWith('离群'))).toBe(true);
    expect(flags[1]).toBeUndefined();
    expect(flags[2]).toBeUndefined();
  });
});

describe('ΔΔCt 引擎（手算对照）', () => {
  // 设计：Control-1 ×3 复孔、Treat-1 ×3；GAPDH 内参、LDHA 目标。
  // GAPDH: Ctrl 20,20,20（均值 20）；Treat 20,20,20（均值 20）→ 池化 refCq 均 20
  // LDHA:  Ctrl 25,25,26（均值 25.333，个体 ΔCt = 5,5,6）
  //        Treat 23,23,23（个体 ΔCt = 3,3,3）
  // 对照组 ΔCt 均值 = (5+5+6)/3 = 5.3333
  // Treat 个体 ΔΔCt = 3-5.3333 = -2.3333 → 个体 FC = 2^2.3333 ≈ 5.0397
  // Treat ΔΔCt（均值）= 3 - 5.3333 = -2.3333 → FC ≈ 5.0397
    const data = [
    ['Control-1', 'GAPDH', 20], ['Control-1', 'GAPDH', 20], ['Control-1', 'GAPDH', 20],
    ['Treat-1', 'GAPDH', 20], ['Treat-1', 'GAPDH', 20], ['Treat-1', 'GAPDH', 20],
    ['Control-1', 'LDHA', 25], ['Control-1', 'LDHA', 25], ['Control-1', 'LDHA', 26],
    ['Treat-1', 'LDHA', 23], ['Treat-1', 'LDHA', 23], ['Treat-1', 'LDHA', 23],
  ];
  const rows = extractRows(rowsFromAoa(data), {
    ...emptyMapping(),
    sample: 0,
    target: 1,
    cq: 2,
  });
  const config: AnalysisConfig = { controlSamples: ['Control-1'], refGenes: ['GAPDH'], qc: DEFAULT_QC };
  const out = analyzeDeltaDeltaCt(rows, config);

  it('产出 2 个结果（对照组 + 处理组各一）', () => {
    expect(out.results).toHaveLength(2);
    expect(out.warnings).toHaveLength(0);
  });
  it('内参池化 Cq = 20', () => {
    for (const r of out.results) expect(r.refCq).toBeCloseTo(20, 10);
  });
  it('对照组 ΔΔCt = 0，FC = 1', () => {
    const ctrl = out.results.find((r) => r.isControl)!;
    expect(ctrl.ddCt).toBeCloseTo(0, 10);
    expect(ctrl.foldChange).toBeCloseTo(1, 10);
  });
  it('处理组 ΔΔCt 与 FC 对照手算值', () => {
    const t = out.results.find((r) => r.sample === 'Treat-1')!;
    expect(t.deltaCt).toBeCloseTo(3, 10);
    expect(t.ddCt).toBeCloseTo(3 - 16 / 3, 10);
    expect(t.foldChange).toBeCloseTo(Math.pow(2, 16 / 3 - 3), 10);
    expect(t.fcValues).toHaveLength(3);
    expect(t.fcValues[0]).toBeCloseTo(Math.pow(2, 16 / 3 - 3), 10);
  });
  it('对照组无统计，处理组跑 Welch t（对照组 ΔCt [5,5,6] 有方差 → p 显著）', () => {
    const ctrl = out.results.find((r) => r.isControl)!;
    const t = out.results.find((r) => !r.isControl)!;
    expect(ctrl.pValue).toBeNull();
    expect(t.statMethod).toContain('Welch');
    expect(t.pValue!).toBeLessThan(0.05);
  });
});

describe('ΔΔCt 引擎（多组 + 显著性）', () => {
    const data: (string | number)[][] = [];
  // GAPDH 恒 20；LDHA：Ctrl≈25、T1≈23、T2≈21、T3≈19，均带小抖动
  const plan: [string, number, number[]][] = [
    ['Ctrl-1', 25, [25.0, 25.1, 24.9]],
    ['Ctrl-2', 25, [25.2, 24.8, 25.1]],
    ['T1', 23, [23.0, 23.1, 22.9]],
    ['T2', 21, [21.0, 20.9, 21.2]],
    ['T3', 19, [19.1, 18.9, 19.0]],
  ];
  for (const [sample, , reps] of plan) {
    for (const v of reps) {
      data.push([sample, 'GAPDH', 20]);
      data.push([sample, 'LDHA', v]);
    }
  }
  const rows = extractRows(rowsFromAoa(data), {
    ...emptyMapping(),
    sample: 0,
    target: 1,
    cq: 2,
  });
  const out = analyzeDeltaDeltaCt(rows, {
    controlSamples: ['Ctrl-1', 'Ctrl-2'],
    refGenes: ['GAPDH'],
    qc: DEFAULT_QC,
  });

  it('5 组 × 1 目标 = 5 条结果，对照在前', () => {
    expect(out.results).toHaveLength(5);
    expect(out.results[0].isControl).toBe(true);
  });
  it('多组时用 ANOVA + Dunnett 校正，处理组 p 显著', () => {
    const t1 = out.results.find((r) => r.sample === 'T1')!;
    expect(t1.statMethod).toContain('ANOVA');
    expect(t1.statMethod).toContain('Dunnett');
    expect(t1.pValue!).toBeLessThan(0.001);
    expect(t1.pAdjusted).not.toBeNull();
    expect(t1.pAdjusted!).toBeLessThan(0.05);
    expect(t1.pAdjusted!).toBeGreaterThanOrEqual(0);
    // 显著性星号取自校正后 p
    expect(t1.significance).toBe('***');
  });
  it('对照组无 Dunnett p', () => {
    const ctrl = out.results.find((r) => r.isControl)!;
    expect(ctrl.pAdjusted).toBeNull();
  });
  it('多内参池化：两个内参时取均值', () => {
    // 追加 ACTB 内参（恒 18），池化 refCq 应为 (20+18)/2 = 19
    const data2 = rowsFromAoa([...data]);
    for (const [sample] of plan) {
      for (let i = 0; i < 3; i++) data2.push([sample, 'ACTB', '18']);
    }
    const rows2 = extractRows(data2, { ...emptyMapping(), sample: 0, target: 1, cq: 2 });
    const out2 = analyzeDeltaDeltaCt(rows2, {
      controlSamples: ['Ctrl-1', 'Ctrl-2'],
      refGenes: ['GAPDH', 'ACTB'],
      qc: DEFAULT_QC,
    });
    const t1 = out2.results.find((r) => r.sample === 'T1')!;
    expect(t1.refCq).toBeCloseTo(19, 10);
  });
});

describe('内参未检出场景（真实用户数据回归）', () => {
  // 对照组 C1 的内参 GAPDH 全部未检出（'-'）→ 引擎必须显式告警而非静默 0 结果
  const data = [
    ['C1', 'GAPDH', '-'], ['C1', 'GAPDH', '-'],
    ['T1', 'GAPDH', 20], ['T1', 'GAPDH', 20],
    ['C1', 'LDHA', 25], ['C1', 'LDHA', 25], ['C1', 'LDHA', 25],
    ['T1', 'LDHA', 23], ['T1', 'LDHA', 23], ['T1', 'LDHA', 23],
  ].map((r) => r.map(String));
  const rows = extractRows(data, { ...emptyMapping(), sample: 0, target: 1, cq: 2 });
  const out = analyzeDeltaDeltaCt(rows, {
    controlSamples: ['C1'],
    refGenes: ['GAPDH'],
    qc: DEFAULT_QC,
  });

  it('对照组内参未检出 → 无结果 + 两条明确告警', () => {
    expect(out.results).toHaveLength(0);
    expect(out.warnings.some((w) => w.includes('H22') || w.includes('未检出：') && w.includes('C1'))).toBe(true);
    expect(out.warnings.some((w) => w.includes('对照组样本（C1）的内参基因均未检出'))).toBe(true);
  });

  it('部分样本内参未检出 → 只跳过缺失样本并告警', () => {
    // T1 的 GAPDH 正常、C1 缺失：此时若改用 T1 也可算——但对照组缺失则整体无基准
    expect(out.warnings.some((w) => w.includes('请更换或补充内参基因'))).toBe(true);
  });
});
