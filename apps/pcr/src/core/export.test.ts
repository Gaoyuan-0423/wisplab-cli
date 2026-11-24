import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildWorkbook, groupResultAoa, resultAoa, toCsv, workbookToBuffer } from './export';
import { extractRows, analyzeDeltaDeltaCt } from './analysis';
import { DEFAULT_QC, emptyMapping, type GroupTargetResult } from './types';

const data = [
  ['C1', 'GAPDH', 20], ['C1', 'GAPDH', 20], ['C1', 'GAPDH', 20],
  ['T1', 'GAPDH', 20], ['T1', 'GAPDH', 20], ['T1', 'GAPDH', 20],
  ['C1', 'LDHA', 25], ['C1', 'LDHA', 25], ['C1', 'LDHA', 26],
  ['T1', 'LDHA', 23], ['T1', 'LDHA', 23], ['T1', 'LDHA', 23],
].map((r) => r.map((c) => String(c)));

const rows = extractRows(data, { ...emptyMapping(), sample: 0, target: 1, cq: 2 });
const out = analyzeDeltaDeltaCt(rows, {
  controlSamples: ['C1'],
  refGenes: ['GAPDH'],
  qc: DEFAULT_QC,
});

describe('导出', () => {
  it('结果表包含 ΔΔCt 与 FC 列', () => {
    const aoa = resultAoa(out);
    expect(aoa[0]).toContain('ΔΔCt');
    expect(aoa[0]).toContain('Fold Change (2^-ΔΔCt)');
    expect(aoa).toHaveLength(3); // 表头 + 2 行
  });
  it('CSV 序列化遵守 RFC 4180 引号规则并带 BOM', () => {
    const csv = toCsv([['a', 'b,c'], ['"q"', 'x']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"b,c"');
    expect(csv).toContain('"""q"""');
  });
  it('separates technical results, independent-unit groups, design and raw measurements', () => {
    const wb = buildWorkbook(out, rows, {}, { fileName: 'demo.csv', refGenes: ['GAPDH'], controlSamples: ['C1'] });
    expect(wb.SheetNames).toEqual(['样本技术描述', '组级独立单位结果', '实验设计与边界', '原始数据与QC', '项目信息']);
    const buf = workbookToBuffer(wb);
    expect(buf.byteLength).toBeGreaterThan(2000); // 真 xlsx zip
  });
  it('does not export legacy sample p-values or imply known biological n without confirmation', () => {
    const stale = { ...out, designStatus: 'unconfirmed' as const, results: out.results.map((r) => ({ ...r, nBio: 3, pValue: 0.012345, pAdjusted: 0.02345, significance: '*', statMethod: 'Welch t' })) };
    const table = resultAoa(stale);
    expect(table[0]).toContain('技术孔数 nTech');
    expect(table[0]).not.toContain('统计方法');
    expect(table[0]).not.toContain('显著性');
    expect(table[1][table[0].indexOf('独立单位数 nBio')]).toBe('');
    expect(JSON.stringify(table)).not.toContain('0.012345');
    const wb = buildWorkbook(stale, rows, {}, { fileName: 'legacy.csv', refGenes: ['GAPDH'], controlSamples: ['C1'] });
    expect(JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets['项目信息'], { header: 1 }))).toContain('仅描述；未进行组间推断');
  });
});

const group: GroupTargetResult = {
  group: 'Treat', target: 'LDHA', isControl: false, nBio: 2, nTech: 9, unitIds: ['U1', 'U2'],
  sampleIds: [{ plate: 'plate-1', sample: 'T1' }, { plate: 'plate-2', sample: 'T1' }],
  deltaCtValues: [2.2, 3.2], deltaCtMean: 2.7, deltaCtSd: Math.SQRT1_2, ddCt: -1,
  foldChange: 2, fcValues: [3, 1], fcMean: 2, fcSd: Math.SQRT2,
  pValue: 0.0123456789012345, pAdjusted: null, anovaPValue: null, significance: '*', statMethod: 'Welch t',
};

it('retains unit counts, source identities and numerical p precision only in confirmed group export', () => {
  const confirmed = { ...out, designStatus: 'confirmed' as const, groupResults: [group] };
  const table = groupResultAoa(confirmed);
  expect(table[1][table[0].indexOf('独立单位数 nBio')]).toBe(2);
  expect(table[1][table[0].indexOf('技术孔数 nTech')]).toBe(9);
  expect(table[1][table[0].indexOf('Welch p')]).toBe(group.pValue);
  expect(table[1][table[0].indexOf('来源样本身份')]).toBe(JSON.stringify(group.sampleIds));
  for (const designStatus of ['unconfirmed', 'invalid', 'unsupported'] as const) {
    const blocked = groupResultAoa({ ...confirmed, designStatus });
    expect(blocked[1][blocked[0].indexOf('Welch p')]).toBe('');
    expect(blocked[1][blocked[0].indexOf('显著性')]).toBe('');
  }
});

for (const language of ['zh', 'en'] as const) {
  it(`exports the actual Pfaffl method and unchanged fold values in ${language}`, () => {
    const corrected = analyzeDeltaDeltaCt(rows, { controlSamples: ['C1'], refGenes: ['GAPDH'], qc: DEFAULT_QC, efficiencies: { LDHA: 92, GAPDH: 100 } });
    expect(corrected.effMode).toBe(true);
    const table = resultAoa(corrected, language);
    expect(table[0][11]).toBe('Fold Change (Pfaffl)');
    expect(Number(table[2][11])).toBeCloseTo(corrected.results[1].foldChange!, 4);
    // Stale UI metadata must not override the method stored with the calculation.
    const wb = buildWorkbook(corrected, rows, {}, { fileName: 'synthetic.csv', refGenes: ['GAPDH'], controlSamples: ['C1'], efficiencies: { LDHA: 100 } }, language);
    const info = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames.at(-1)!], { header: 1 });
    const text = JSON.stringify(info);
    expect(text).toContain('Pfaffl');
    expect(text).not.toContain('Livak');
    expect(text).toContain('92%');
    expect(resultAoa(out, language)[0][11]).toBe('Fold Change (2^-ΔΔCt)');
  });
}
