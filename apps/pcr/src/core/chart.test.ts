import { describe, expect, it } from 'vitest';
import { multiGeneChartSvg } from './chart-svg';
import { buildBarsForGene, annotationText } from './chart-bars';
import { DEFAULT_CHART_OPTIONS, type ChartOptions } from './chart-options';
import type { SampleTargetResult } from './types';

function fakeResult(sample: string, target: string, values: number[], isControl = false): SampleTargetResult {
  return {
    sample,
    group: '',
    target,
    isControl,
    excluded: false,
    n: values.length,
    values,
    wells: [],
    meanCq: 20,
    sdCq: 0.2,
    refCq: 18,
    deltaCt: 2,
    deltaCtValues: values,
    ddCt: 0,
    foldChange: 2,
    fcValues: values,
    fcMean: 2,
    fcSd: 0.3,
    pValue: 0.02,
    pAdjusted: 0.03,
    significance: '*',
    statMethod: 'Welch t',
  };
}

const base: ChartOptions = { ...DEFAULT_CHART_OPTIONS, width: 860, height: 460 };

describe('多基因分段图 SVG', () => {
  const results = [
    fakeResult('Control-1', 'GAPDH', [2, 2.1, 1.9], true),
    fakeResult('Treat-1', 'GAPDH', [4, 4.2, 3.8]),
    fakeResult('Control-1', 'LDHA', [1, 1.05, 0.95], true),
    fakeResult('Treat-1', 'LDHA', [3, 3.1, 2.9]),
  ];
  const bars = buildBarsForGene(results, base, (r) => (r.isControl ? '#999' : '#0e7c66'));
  const svg = multiGeneChartSvg(
    [
      { gene: 'GAPDH', bars: bars.filter((b) => b.target === 'GAPDH') },
      { gene: 'LDHA', bars: bars.filter((b) => b.target === 'LDHA') },
    ],
    base,
  );

  it('包含两段基因标签与样本名', () => {
    expect(svg).toContain('>GAPDH<');
    expect(svg).toContain('>LDHA<');
    expect(svg).toContain('>Control-1<');
  });

  it('名称覆盖生效（图上显示覆盖名）', () => {
    const opts: ChartOptions = { ...base, labelOverrides: { 'Treat-1': '敲除组' } };
    const bars2 = buildBarsForGene(results.filter((r) => r.target === 'LDHA'), opts, (r) => (r.isControl ? '#999' : '#0e7c66'));
    const svg2 = multiGeneChartSvg([{ gene: 'LDHA', bars: bars2 }], opts);
    expect(svg2).toContain('>敲除组<');
    expect(svg2).not.toContain('>Treat-1<');
  });

  it('显著性模式 = p 值时图上出现 p= 文本', () => {
    const opts: ChartOptions = { ...base, showP: 'p' };
    const bars2 = buildBarsForGene(results.filter((r) => r.target === 'GAPDH'), opts, (r) => (r.isControl ? '#999' : '#0e7c66'));
    const svg2 = multiGeneChartSvg([{ gene: 'GAPDH', bars: bars2 }], opts);
    expect(svg2).toContain('p=');
    expect(svg2).not.toContain('**');
  });

  it('log2 刻度：刻度为 2 的幂，svg 正常产出', () => {
    const opts: ChartOptions = { ...base, yScale: 'log2' };
    const svg2 = multiGeneChartSvg(
      [{ gene: 'GAPDH', bars: buildBarsForGene(results.filter((r) => r.target === 'GAPDH'), opts, (r) => (r.isControl ? '#999' : '#0e7c66')) }],
      opts,
    );
    expect(svg2).toContain('<svg');
    expect(svg2).not.toContain('NaN');
  });

  it('线性 + 手动上限低于数据 → 画截断标记且不产生 NaN', () => {
    const opts: ChartOptions = { ...base, yMax: 3 };
    const svg2 = multiGeneChartSvg(
      [{ gene: 'GAPDH', bars: buildBarsForGene(results.filter((r) => r.target === 'GAPDH'), opts, (r) => (r.isControl ? '#999' : '#0e7c66')) }],
      opts,
    );
    expect(svg2).toContain('stroke-width="1.4"'); // 截断双斜线
    expect(svg2).not.toContain('NaN');
  });
});

describe('标注模式', () => {
  const bar = buildBarsForGene([fakeResult('T1', 'G', [3, 3])], base, () => '#0e7c66')[0];
  it('stars 模式输出星号', () => {
    expect(annotationText({ ...base, showP: 'stars' }, bar)).toBe('*');
  });
  it('p 模式输出 p 值', () => {
    expect(annotationText({ ...base, showP: 'p' }, bar)).toBe('p=0.0300');
  });
  it('both 模式两者都有', () => {
    const t = annotationText({ ...base, showP: 'both' }, bar)!;
    expect(t).toContain('*');
    expect(t).toContain('p=');
  });
  it('none 模式为空', () => {
    expect(annotationText({ ...base, showP: 'none' }, bar)).toBeNull();
  });
});
