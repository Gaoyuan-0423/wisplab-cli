import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { createYAxisBreakScale, getYAxisBreakError, suggestYAxisBreak, Y_AXIS_BREAK_GAP } from './chart-break';
import { DEFAULT_CHART_OPTIONS } from './chart-options';
import type { ChartBar } from './chart-bars';
import { multiGeneChartSvg } from './chart-svg';

const breakOptions = { bottomMax: 2, topMin: 8, topMax: 16, bottomPct: 65 };
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: true });
function bar(value: number, err = 0, label = 'Treat'): ChartBar {
  return { sample: label, label, target: 'G', value, err, isControl: label === 'Control', color: '#1a1a1a', p: null, pAdj: null, stars: '' };
}
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];

describe('真实断轴范围和映射', () => {
  it('允许上段下限低于数据的自动上限，并独立检查严格递增边界', () => {
    expect(getYAxisBreakError(breakOptions, 0)).toBeNull();
    for (const invalid of [
      { ...breakOptions, bottomMax: 0 },
      { ...breakOptions, topMin: 2 },
      { ...breakOptions, topMax: 8 },
      { ...breakOptions, topMin: NaN },
      { ...breakOptions, topMax: Infinity },
      { ...breakOptions, bottomPct: 0 },
      { ...breakOptions, bottomPct: 100 },
    ]) expect(getYAxisBreakError(invalid, 0)).not.toBeNull();
  });

  it('四个边界映射到上下两段边缘，省略区间严格落在18px留白内', () => {
    const scale = createYAxisBreakScale(breakOptions, 0, 40, 300)!;
    expect(scale.toY(0)).toBe(340);
    expect(scale.toY(2)).toBeCloseTo(scale.gapBottom);
    expect(scale.toY(8)).toBeCloseTo(scale.gapTop);
    expect(scale.toY(16)).toBeCloseTo(40);
    expect(scale.gapBottom - scale.gapTop).toBe(Y_AXIS_BREAK_GAP);
    expect(scale.toY(5)).toBeGreaterThan(scale.gapTop);
    expect(scale.toY(5)).toBeLessThan(scale.gapBottom);
    const values = [0, 1, 2, 3, 5, 7, 8, 12, 16, 20].map(scale.toY);
    expect(values.every((value, index) => index === 0 || value < values[index - 1])).toBe(true);
    expect(scale.isVisible(2)).toBe(true);
    expect(scale.isVisible(8)).toBe(true);
    expect(scale.isVisible(5)).toBe(false);
    expect(scale.isVisible(17)).toBe(false);
  });

  it('推荐空隙不吞掉任何均值或误差端点，并完整容纳数据上限', () => {
    const values = [0.8, 1, 1.2, 9, 10, 11, NaN, Infinity];
    const recommended = suggestYAxisBreak(values, 0);
    expect(getYAxisBreakError(recommended, 0)).toBeNull();
    expect(recommended.bottomMax).toBeGreaterThan(1.2);
    expect(recommended.topMin).toBeLessThan(9);
    expect(recommended.topMax).toBeGreaterThanOrEqual(11);
    expect(values.some((value) => value > recommended.bottomMax && value < recommended.topMin)).toBe(false);
    expect(getYAxisBreakError(suggestYAxisBreak([], 0), 0)).toBeNull();
    expect(getYAxisBreakError(suggestYAxisBreak([1], 0), 0)).toBeNull();
    const narrow = suggestYAxisBreak([1, 1 + 1e-8], 0);
    expect(getYAxisBreakError(narrow, 0)).toBeNull();
  });
});

describe('断轴 SVG 保留数据与标签', () => {
  function render(bars = [bar(1, 0.2, 'Control'), bar(10, 1)]) {
    return parser.parse(multiGeneChartSvg([{ gene: 'G', bars }], { ...DEFAULT_CHART_OPTIONS, showP: 'none', yBreak: breakOptions })).svg;
  }

  it('即使自动Y上限超过topMin仍绘制两个非相接裁剪区和分离Y轴', () => {
    const svg = render();
    const clips = array<any>(svg.defs.clipPath.rect).sort((a, b) => a.y - b.y);
    expect(clips).toHaveLength(2);
    expect(clips[1].y - clips[0].y - clips[0].height).toBeCloseTo(Y_AXIS_BREAK_GAP);
    const groups = array<any>(svg.g);
    const axis = groups.find((group) => group.class === 'chart-y-axis');
    expect(axis.line).toHaveLength(2);
    expect(axis.line.every((line: any) => line.y2 <= clips[0].y + clips[0].height || line.y1 >= clips[1].y)).toBe(true);
    const data = groups.find((group) => group.class === 'chart-data');
    const high = data.rect[1];
    expect(high.y).toBeLessThan(clips[0].y + clips[0].height);
    expect(high.y + high.height).toBeCloseTo(clips[1].y + clips[1].height);
    const labels = groups.find((group) => group.class === 'chart-axis-labels');
    expect(labels['clip-path']).toBeUndefined();
    expect(array<any>(labels.text).map((label) => label['#text'])).toEqual(['Control', 'Treat']);
    expect(svg.text.some((text: any) => text.class === 'chart-y-label' && text['#text'] === 'Fold Change')).toBe(true);
  });

  it('均值落在省略区间不会误投射到上段，误差端点也不会在断口产生端帽', () => {
    const svg = render([bar(5, 4), bar(5, 1), bar(8, 1)]);
    const clips = array<any>(svg.defs.clipPath.rect).sort((a, b) => a.y - b.y);
    const gapTop = clips[0].y + clips[0].height;
    const gapBottom = clips[1].y;
    const data = array<any>(svg.g).find((group) => group.class === 'chart-data');
    expect(data.rect[0].y).toBeGreaterThan(gapTop);
    expect(data.rect[0].y).toBeLessThan(gapBottom);
    const errors = array<any>(data.g);
    expect(array(errors[0].line)).toHaveLength(3); // 端点1和9跨越留白，两端帽保留。
    expect(array(errors[1].line)).toHaveLength(1); // 端点4和6都隐藏，只保留可裁剪的线身。
    expect(array(errors[2].line)).toHaveLength(2); // 端点7隐藏，端点9保留。
  });

  it('无效边界和对数模式安全回退到连续轴', () => {
    for (const options of [
      { yBreak: { ...breakOptions, topMin: 1 } },
      { yBreak: { ...breakOptions, bottomPct: NaN } },
      { yBreak: breakOptions, yScale: 'log2' as const },
    ]) {
      const source = multiGeneChartSvg([{ gene: 'G', bars: [bar(1), bar(10)] }], { ...DEFAULT_CHART_OPTIONS, ...options });
      expect(source).not.toContain('NaN');
      const svg = parser.parse(source).svg;
      expect(array(svg.defs.clipPath.rect)).toHaveLength(1);
      expect(array<any>(svg.g).some((group) => group.class === 'chart-axis-break')).toBe(false);
    }
  });

  it('多基因仅显示基因轴标签，保持比例且整图缩放不改viewBox', () => {
    const segments = ['BRCA1', 'CD79A', 'GP6D', 'PRKCB', 'RPSA', 'SLC22A5']
      .map((gene) => ({ gene, bars: [bar(1, 0.2, 'Control'), bar(10, 1)] }));
    for (const fontSize of [8, 28]) for (const groupWidth of [0.2, 1]) {
      const options = { ...DEFAULT_CHART_OPTIONS, width: 640, height: 360, fontSize, groupWidth };
      const normal = parser.parse(multiGeneChartSvg(segments, options)).svg;
      const scaled = parser.parse(multiGeneChartSvg(segments, { ...options, imageScale: 1.5 })).svg;
      expect(normal.width / normal.height).toBeCloseTo(16 / 9, 10);
      expect(scaled.viewBox).toBe(normal.viewBox);
      expect(scaled.width).toBeCloseTo(normal.width * 1.5);
      expect(scaled.height).toBeCloseTo(normal.height * 1.5);
      const labels = array<any>(normal.g).find((group) => group.class === 'chart-axis-labels');
      expect(array<any>(labels.text).map((label) => label['#text'])).toEqual(segments.map((segment) => segment.gene));
      expect(array<any>(normal.g).filter((group) => group.class === 'chart-legend')).toHaveLength(1);
    }
  });
});
