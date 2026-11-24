import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { isStandardRow } from './analysis';
import { analyzeAuto } from './auto';
import { fitStandardCurve, parseQuantityFromName } from './standard';

const here = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = join(here, '../../tests/fixtures');

function loadMatrix(rel: string): string[][] {
  const wb = XLSX.read(readFileSync(join(FIXTURES, rel), 'utf-8'), { type: 'string', raw: false });
  const json = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
  return json.map((r) => (r ?? []).map((v) => (v == null ? '' : String(v).trim()))).filter((r) => r.some((c) => c.length > 0));
}

describe('数量解析', () => {
  it('稀释比 / 幂 / 科学计数 / 大数 / 序列号拒绝', () => {
    expect(parseQuantityFromName('1:10')).toBeCloseTo(0.1);
    expect(parseQuantityFromName('std 1:100')).toBeCloseTo(0.01);
    expect(parseQuantityFromName('10^4')).toBe(10000);
    expect(parseQuantityFromName('1e5')).toBe(100000);
    expect(parseQuantityFromName('Std_100000')).toBe(100000);
    expect(parseQuantityFromName('Std-1')).toBeNull(); // 序列号，保守不猜
    expect(parseQuantityFromName('Control-1')).toBeNull();
  });
});

describe('标准品判定', () => {
  it('Task 列与样本名两种途径', () => {
    expect(isStandardRow({ sample: 'WT', task: 'STANDARD' })).toBe(true);
    expect(isStandardRow({ sample: 'Std_100000', task: '' })).toBe(true);
    expect(isStandardRow({ sample: 'standard-2', task: '' })).toBe(true);
    expect(isStandardRow({ sample: '标准品1', task: '' })).toBe(true);
    expect(isStandardRow({ sample: '标准1', task: '' })).toBe(true);
    expect(isStandardRow({ sample: 'Student-1', task: '' })).toBe(false);
    expect(isStandardRow({ sample: 'WT', task: '' })).toBe(false);
  });
});

describe('最小二乘拟合', () => {
  it('严格直线：Cq = 30.5 − 3.2·log10(Q)', () => {
    const curve = fitStandardCurve([
      { cq: 14.5, quantity: 100000 },
      { cq: 17.7, quantity: 10000 },
      { cq: 20.9, quantity: 1000 },
      { cq: 24.1, quantity: 100 },
    ])!;
    expect(curve.slope).toBeCloseTo(-3.2, 6);
    expect(curve.r2).toBeCloseTo(1, 8);
    // 10^(1/3.2) − 1 ≈ 105.35%
    expect(curve.effPct).toBeCloseTo((Math.pow(10, 1 / 3.2) - 1) * 100, 4);
    expect(curve.n).toBe(4);
  });
  it('点数不足 / 斜率为正 → null', () => {
    expect(fitStandardCurve([{ cq: 15, quantity: 100 }, { cq: 18, quantity: 10 }])).toBeNull();
    expect(fitStandardCurve([{ cq: 15, quantity: 10 }, { cq: 18, quantity: 100 }, { cq: 21, quantity: 1000 }])).toBeNull();
  });
});

describe('一键分析自动应用标准曲线', () => {
  const r = analyzeAuto(loadMatrix('standard-curve-style.csv'), { fileName: 'standard-curve-style.csv' });

  it('R²=1 的拟合自动写入效率并触发 Pfaffl', () => {
    expect(r.output.effMode).toBe(true);
    expect(r.config.efficiencies?.LDHA).toBeCloseTo((Math.pow(10, 1 / 3.2) - 1) * 100, 1);
    expect(r.output.efficiencies.LDHA).toBeCloseTo((Math.pow(10, 1 / 3.2) - 1) * 100, 1);
  });
  it('标准品不进入结果样本', () => {
    expect(r.output.results.every((x) => !/^Std/.test(x.sample))).toBe(true);
  });
  it('报告记录标准曲线应用', () => {
    const applied = r.report.issues.filter((i) => i.code === 'STD_CURVE_APPLIED');
    expect(applied).toHaveLength(2); // GAPDH + LDHA
    expect(applied[0].message).toContain('R²');
  });
});
