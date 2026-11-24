import { describe, expect, it } from 'vitest';
import { extractRows } from './analysis';
import { sniff } from './sniff';

// 回归：国产绝对定量导出（天隆风格，中文表头）。真实用户文件曾把 Cq 映射到
// "Ct CV(%)"（全 0 的变异系数列）——离散度表头现在被一票否决，"Ct平均值"
// 靠 CJK 前缀匹配（ct平均值 startsWith ct）命中。

const HEADERS = [
  '重复组', '孔位', '样本名称', '样本类型', '荧光', '目标基因',
  'Ct平均值', 'Ct标准差', 'Ct CV(%)', '浓度平均值', '浓度标准差', '浓度CV(%)',
  'Log浓度平均值', '浓度单位', '参比荧光',
];

function matrix(data: string[][]): string[][] {
  return [HEADERS, ...data];
}

describe('国产绝对定量导出（中文表头）', () => {
  const m = matrix([
    ['', 'A3', 'H22 N', '待测', 'SYBR GreenⅠ', 'ACTB', '-', '-', '0', '-', '-', '0', '-', 'IU/ml', ''],
    ['', 'A4', 'H22 N', '待测', 'SYBR GreenⅠ', 'RPSA', '18.301', '0', '0', '-', '-', '0', '-', 'IU/ml', ''],
    ['', 'A5', 'H22 N', '待测', 'SYBR GreenⅠ', 'SLC22A5', '26.145', '0', '0', '-', '-', '0', '-', 'IU/ml', ''],
    ['', 'B3', 'H22 T', '待测', 'SYBR GreenⅠ', 'ACTB', '21.5', '0', '0', '-', '-', '0', '-', 'IU/ml', ''],
    ['', 'B4', 'H22 T', '待测', 'SYBR GreenⅠ', 'RPSA', '19.2', '0', '0', '-', '-', '0', '-', 'IU/ml', ''],
  ]);
  const s = sniff(m);

  it('Cq 映射到 Ct平均值，而不是 Ct CV(%)', () => {
    expect(s.mapping.cq).toBe(6); // Ct平均值
    expect(s.mapping.cq).not.toBe(8); // Ct CV(%)
  });
  it('样本/基因/孔位映射正确', () => {
    expect(s.mapping.sample).toBe(2); // 样本名称
    expect(s.mapping.target).toBe(5); // 目标基因
    expect(s.mapping.well).toBe(1); // 孔位
  });
  it('"-" 未检出解析为 NaN（自动跳过）', () => {
    const rows = extractRows(m.slice(s.headerRow + 1), s.mapping);
    expect(rows).toHaveLength(5);
    expect(Number.isNaN(rows[0].cq)).toBe(true); // '-' 行
    expect(rows[1].cq).toBeCloseTo(18.301, 3);
  });
});
