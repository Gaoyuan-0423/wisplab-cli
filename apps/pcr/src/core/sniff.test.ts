import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { sheetToMatrix } from './parse';
import { normalizeHeader, sniff } from './sniff';

const FIXTURES = join(fileURLToPath(new URL('.', import.meta.url)), '../../tests/fixtures');

function loadFixture(name: string): string[][] {
  const text = readFileSync(join(FIXTURES, name), 'utf-8');
  const wb = XLSX.read(text, { type: 'string', raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true });
  return json.map((row) => (row ?? []).map((v) => (v == null ? '' : String(v).trim())));
}

describe('normalizeHeader', () => {
  it('去括注、转小写、统一分隔符', () => {
    expect(normalizeHeader('CT (Rx1)')).toBe('ct');
    expect(normalizeHeader('Sample_Name')).toBe('sample name');
    expect(normalizeHeader('  目标基因 ')).toBe('目标基因');
  });
});

describe('CFX 风格（CSV 单表头行）', () => {
  const m = loadFixture('cfx-style.csv');
  const r = sniff(m);

  it('表头行 = 第 0 行', () => {
    expect(r.headerRow).toBe(0);
  });
  it('列映射正确', () => {
    expect(r.mapping.sample).toBe(2); // Sample Name
    expect(r.mapping.target).toBe(3); // Target Name
    expect(r.mapping.cq).toBe(5); // Cq Mean
    expect(r.mapping.well).toBe(1); // Well Position（数字 Well 列被内容校验排除）
  });
});

describe('QuantStudio 风格（元数据行 + Tab 分隔）', () => {
  const m = loadFixture('quantstudio-style.txt');
  const r = sniff(m);

  it('跳过元数据找到表头行', () => {
    expect(r.headerRow).toBeGreaterThan(0);
    expect(m[r.headerRow].some((h) => normalizeHeader(h) === 'sample name')).toBe(true);
  });
  it('列映射正确', () => {
    expect(r.mapping.sample).toBe(m[r.headerRow].indexOf('Sample Name'));
    expect(r.mapping.cq).toBe(m[r.headerRow].indexOf('CT'));
    expect(r.mapping.well).toBe(m[r.headerRow].indexOf('Well Position'));
  });
});

describe('LightCycler 风格（CP/Detection Cell 非标准命名）', () => {
  const m = loadFixture('lc480-style.csv');
  const r = sniff(m);

  it('CP 列映射为 Cq', () => {
    expect(r.mapping.cq).toBe(3); // CP
  });
  it('Position 列映射为孔位', () => {
    expect(r.mapping.well).toBe(0);
  });
  it('Detection Cell 列经内容兜底识别为目标基因', () => {
    expect(r.mapping.target).toBe(2);
  });
});

describe('sheetToMatrix', () => {
  it('从工作簿读取并切分表头/数据', () => {
    const wb = XLSX.read(readFileSync(join(FIXTURES, 'cfx-style.csv'), 'utf-8'), { type: 'string' });
    const m = sheetToMatrix(wb, wb.SheetNames[0]);
    expect(m.headers[0]).toBe('Well');
    expect(m.rows.length).toBe(48);
    expect(m.rows[0][4]).toBe('Unknown');
  });
});
