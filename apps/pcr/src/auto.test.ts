import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { analyzeAuto, inferExperiment } from './core/auto';

const here = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = join(here, '../tests/fixtures');

function loadMatrix(rel: string): string[][] {
  const wb = XLSX.read(readFileSync(join(FIXTURES, rel), 'utf-8'), { type: 'string', raw: false });
  const json = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
  return json.map((r) => (r ?? []).map((v) => (v == null ? '' : String(v).trim()))).filter((r) => r.some((c) => c.length > 0));
}

describe('inferExperiment 对照组推断', () => {
  it('英文命名：Control/Wt/Sham', () => {
    const g = inferExperiment(['Control-1', 'Control-2', 'Treat-1', 'WT'], ['GAPDH', 'LDHA']);
    expect(g.controlSamples.sort()).toEqual(['Control-1', 'Control-2', 'WT']);
  });
  it('中文命名：对照组/假手术', () => {
    const g = inferExperiment(['对照组1', '假手术-1', '模型组1'], ['GAPDH']);
    expect(g.controlSamples.sort()).toEqual(['假手术-1', '对照组1']);
  });
  it('组别列优先于样本名', () => {
    const g = inferExperiment(['S1', 'S2', 'S3'], ['GAPDH'], (s) => (s === 'S1' ? 'sham' : 'MCAO'));
    expect(g.controlSamples).toEqual(['S1']);
    expect(g.basis).toContain('sham');
  });
  it('NTC 不算对照组', () => {
    const g = inferExperiment(['NTC', 'Treat-1'], ['GAPDH']);
    expect(g.controlSamples).toEqual([]);
  });
  it('无命中时返回空并说明', () => {
    const g = inferExperiment(['AiW002', 'KYOU'], ['PAX6']);
    expect(g.controlSamples).toEqual([]);
    expect(g.basis).toContain('未推断出');
  });
});

describe('analyzeAuto 一键分析', () => {
  const r = analyzeAuto(loadMatrix('cfx-style.csv'), { fileName: 'cfx-style.csv', sheetName: 'Sheet1' });

  it('自动映射完成且内参自动勾选', () => {
    expect(r.mapping.sample).toBe(2);
    expect(r.mapping.cq).toBe(5);
    expect(r.guess.refGenes).toContain('GAPDH');
  });
  it('对照组自动推断为 Control-1/2/3', () => {
    expect(r.guess.controlSamples).toEqual(['Control-1', 'Control-2', 'Control-3']);
  });
  it('产出结果与统计', () => {
    expect(r.output.results.length).toBeGreaterThan(0);
    expect(r.output.results.some((x) => x.pAdjusted != null)).toBe(true);
  });
  it('发现 FK 血样外离群孔为问题（Cq 29.70 行触发复孔 SD 警告）', () => {
    expect(r.report.issues.some((i) => i.code === 'HIGH_REPLICATE_SD')).toBe(true);
  });
  it('质量分为扣分制且含摘要', () => {
    expect(r.report.score).toBeLessThanOrEqual(100);
    expect(r.report.score).toBeGreaterThanOrEqual(0);
    expect(r.report.summary.length).toBeGreaterThan(0);
  });

  it('NTC 污染文件产生 error 级问题与建议', () => {
    const r2 = analyzeAuto(loadMatrix('cfx-ntc-style.csv'));
    expect(r2.report.issues.some((i) => i.code === 'NTC_CONTAMINATED' && i.severity === 'error')).toBe(true);
    expect(r2.report.advice.some((a) => a.code === 'NTC_TROUBLESHOOT')).toBe(true);
    // NTC 样本不进结果
    expect(r2.output.results.every((x) => !/^NTC/.test(x.sample))).toBe(true);
  });

  it('干净数据得高分', () => {
    // QuantStudio 合成数据：无污染、复孔整齐（NTC 无扩增不扣分）
    const r3 = analyzeAuto(loadMatrix('quantstudio-style.txt'));
    const errors = r3.report.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
    expect(r3.report.score).toBeGreaterThanOrEqual(80);
  });
});
