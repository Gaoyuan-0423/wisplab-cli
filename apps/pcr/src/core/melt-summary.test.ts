import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseMeltSummaryTable } from './melt';

const here = fileURLToPath(new URL('.', import.meta.url));
const REAL = join(here, '../../tests/fixtures/real');

function loadMatrix(path: string): string[][] {
  const wb = XLSX.read(readFileSync(path, 'utf-8'), { type: 'string', raw: false });
  const json = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
  return json.map((r) => (r ?? []).map((v) => (v == null ? '' : String(v).trim()))).filter((r) => r.some((c) => c.length > 0));
}

describe('熔解摘要表解析（真实 LightCycler No. Tm 导出）', () => {
  const matrix = loadMatrix(join(REAL, 'MeltingCurvesLorenzo.csv'));
  const parsed = parseMeltSummaryTable(matrix);

  it('识别格式并解析出孔位条目', () => {
    expect(parsed).not.toBeNull();
    expect(parsed!.size).toBeGreaterThan(50);
  });
  it('单峰孔：A1 → 1 峰、Tm 80.6', () => {
    expect(parsed!.get('A1')).toEqual({ peaks: 1, tm: 80.6 });
  });
  it('孔位规范化：A01 ≡ A1', () => {
    expect(parsed!.has('A1')).toBe(true);
    expect(parsed!.has('A01')).toBe(false);
  });
  it('无峰孔：0 峰、Tm 为空', () => {
    const a4 = parsed!.get('A4')!;
    expect(a4.peaks).toBe(0);
    expect(a4.tm).toBeNull();
  });
  it('定量表不会被误识别为熔解摘要表', () => {
    const quant = loadMatrix(join(REAL, '2019-04-25_124559-GAPDH.csv'));
    expect(parseMeltSummaryTable(quant)).toBeNull();
  });
});
