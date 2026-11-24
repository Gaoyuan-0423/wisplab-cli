import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { analyzeFileAuto } from './auto';
import { parseRdml } from './rdml';
import { sniff } from './sniff';

const here = fileURLToPath(new URL('.', import.meta.url));
const REAL = join(here, '../../tests/fixtures/real');

function loadBytes(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(join(REAL, rel)));
}

describe('真实 RDML：StepOne（v1.0，含标准品与靶标效率）', () => {
  const parsed = parseRdml(loadBytes('stepone_std.rdml'));
  const s = sniff(parsed.matrix);

  it('合成矩阵被表头嗅探完整映射', () => {
    expect(s.mapping.sample).toBeGreaterThanOrEqual(0);
    expect(s.mapping.target).toBeGreaterThanOrEqual(0);
    expect(s.mapping.cq).toBeGreaterThanOrEqual(0);
    expect(s.mapping.quantity).toBeGreaterThanOrEqual(0);
  });
  it('24 个反应 × 1 靶标，NTC/STANDARD 任务正确映射', () => {
    const headers = parsed.matrix[0];
    const iTask = headers.indexOf('Task');
    const iSample = headers.indexOf('Sample Name');
    const rows = parsed.matrix.slice(1);
    expect(rows.length).toBe(24);
    const tasks = [...new Set(rows.map((r) => r[iTask]))].sort();
    expect(tasks).toContain('NTC');
    expect(tasks).toContain('STANDARD');
    expect(rows.some((r) => r[iSample] === 'NTC_RNase P')).toBe(true);
  });
  it('靶标声明的效率被提取（RNase P，解析保留两位小数）', () => {
    expect(parsed.targetEfficiencies['RNase P']).toBeCloseTo(93.91, 2);
  });
  it('一键分析（analyzeFileAuto 端到端）：RDML 声明效率进入配置并写入报告', async () => {
    const bytes = loadBytes('stepone_std.rdml');
    const file = new File([bytes.slice().buffer as ArrayBuffer], 'stepone_std.rdml');
    const r = await analyzeFileAuto(file);
    // 该文件只有 RNase P（内参角色）无目标基因 → 不出 ΔΔCt 结果，但效率链路全通
    expect(r.output.efficiencies['RNase P']).toBeCloseTo(93.91, 1);
    expect(r.report.issues.some((i) => i.code === 'RDML_EFFICIENCY_APPLIED')).toBe(true);
    expect(r.output.warnings.some((w) => w.includes('内参'))).toBe(true);
  });
});

describe('真实 RDML：LC96（v1.1，多 XML 条目、UUID 样本）', () => {
  const parsed = parseRdml(loadBytes('lc96_bACTXY.rdml'));

  it('选择 rdml_data.xml 并解析出多 run 数据', () => {
    expect(parsed.runCount).toBeGreaterThan(0);
    expect(parsed.matrix.length).toBeGreaterThan(10);
  });
  it('UUID 样本用 description 作显示名', () => {
    const iSample = parsed.matrix[0].indexOf('Sample Name');
    const names = parsed.matrix.slice(1).map((r) => r[iSample]);
    expect(names.some((n) => /^Sample \d+$/.test(n))).toBe(true);
    expect(names.every((n) => !/^[0-9a-f-]{36}$/i.test(n))).toBe(true);
  });
});

describe('真实 RDML：Bio-Rad（v1.1，带前缀命名空间 + 熔解数据）', () => {
  const parsed = parseRdml(loadBytes('BioRad_qPCR_melt.rdml'));
  it('命名空间前缀被剥离，样本类型 ntc 识别', () => {
    const iTask = parsed.matrix[0].indexOf('Task');
    expect(parsed.matrix.length).toBeGreaterThan(5);
    expect(parsed.matrix.slice(1).some((r) => r[iTask] === 'NTC')).toBe(true);
  });
});

describe('合成最小 RDML（ZIP 容器）', () => {
  const xml = `<?xml version="1.0"?>
<rdml version="1.1" xmlns="http://www.rdml.org">
  <sample id="s1"><name>Ctrl-1</name><type>unkn</type></sample>
  <sample id="s2"><name>Treat-1</name><type>unkn</type></sample>
  <target id="t1"><name>GAPDH</name><amplificationEfficiency>1.98</amplificationEfficiency></target>
  <experiment id="E1"><run id="R1">
    <react id="A1"><sample id="s1"/><data><tar id="t1"/><cq>20.1</cq></data></react>
    <react id="B1"><sample id="s2"/><data><tar id="t1"/><cq>19.9</cq></data></react>
  </run></experiment>
</rdml>`;
  const zipped = zipSync({ 'rdml_data.xml': strToU8(xml) });
  const parsed = parseRdml(zipped);

  it('系数型效率（1.98 → 98%）归一化', () => {
    expect(parsed.targetEfficiencies['GAPDH']).toBeCloseTo(98, 6);
  });
  it('name 元素优先于 id', () => {
    expect(parsed.matrix[1][2]).toBe('Ctrl-1');
    expect(parsed.matrix[2][2]).toBe('Treat-1');
  });
  it('裸 XML（非 ZIP）同样可解析', () => {
    const bare = parseRdml(new TextEncoder().encode(xml));
    expect(bare.matrix.length).toBe(3);
  });
  it('非 RDML 内容报错', () => {
    expect(() => parseRdml(new TextEncoder().encode('<html></html>'))).toThrow(/RDML/);
  });
});
