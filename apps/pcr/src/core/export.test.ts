import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildWorkbook, resultAoa, toCsv, workbookToBuffer } from './export';
import { extractRows, analyzeDeltaDeltaCt } from './analysis';
import { DEFAULT_QC, emptyMapping } from './types';

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
  it('工作簿含 ΔΔCt 结果 / 原始数据与QC / 项目信息 三个 sheet', () => {
    const wb = buildWorkbook(out, rows, {}, { fileName: 'demo.csv', refGenes: ['GAPDH'], controlSamples: ['C1'] });
    expect(wb.SheetNames).toEqual(['ΔΔCt结果', '原始数据与QC', '项目信息']);
    const buf = workbookToBuffer(wb);
    expect(buf.byteLength).toBeGreaterThan(2000); // 真 xlsx zip
  });
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
