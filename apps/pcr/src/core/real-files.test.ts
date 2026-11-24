import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { extractRows } from './analysis';
import { sniff } from './sniff';
import { detectPlateLayout } from './plate';

// tests/fixtures/real/ 下的真实仪器导出文件（来自公开数据集，见该目录 PROVENANCE.md）。
// 这组测试保证解析管线对"真实世界的脏文件"不回退。
const REAL_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '../../tests/fixtures/real');

function loadMatrix(name: string): string[][] {
  const text = readFileSync(join(REAL_DIR, name), 'utf-8');
  const wb = XLSX.read(text, { type: 'string', raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true });
  return json.map((row) => (row ?? []).map((v) => (v == null ? '' : String(v).trim()))).filter((r) => r.some((c) => c.length > 0));
}

const files = readdirSync(REAL_DIR).filter((f) => /\.(csv|txt|tsv)$/i.test(f));

describe.skipIf(files.length === 0)('真实仪器导出文件（tests/fixtures/real）', () => {
  for (const file of files) {
    // 熔解摘要表（LightCycler No. Tm 格式）不是定量表，无 样本/基因/Cq 三列语义
    if (/melt/i.test(file)) continue;
    it(`${file}：表头检测 + 必需列映射完成 + 数据行非空`, () => {
      const matrix = loadMatrix(file);
      expect(matrix.length).toBeGreaterThan(5);
      const r = sniff(matrix);
      const headers = matrix[r.headerRow];
      const rows = extractRows(matrix.slice(r.headerRow + 1), r.mapping);
      expect(r.mapping.sample, `sample 列（表头行 ${r.headerRow}）`).toBeGreaterThanOrEqual(0);
      expect(r.mapping.target, `target 列（表头行 ${r.headerRow}）`).toBeGreaterThanOrEqual(0);
      expect(r.mapping.cq, `cq 列（表头行 ${r.headerRow}）`).toBeGreaterThanOrEqual(0);
      expect(rows.length).toBeGreaterThan(10);
      const withCq = rows.filter((row) => Number.isFinite(row.cq));
      expect(withCq.length).toBeGreaterThan(10);
      if (r.mapping.well >= 0) {
        expect(detectPlateLayout(rows.map((row) => row.well))).not.toBeNull();
      }
      void headers;
    });
  }
});
