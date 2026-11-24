import { meanAndError, type ChartOptions } from './chart-options';
import { formatP, significanceStars } from './stats';
import type { SampleTargetResult } from './types';

export interface ChartBar {
  sample: string;
  /** 图上显示名（可被用户覆盖） */
  label: string;
  target: string;
  value: number;
  err: number;
  isControl: boolean;
  color: string;
  p: number | null;
  pAdj: number | null;
  stars: string;
}

export interface GeneSegment {
  gene: string;
  bars: ChartBar[];
}

/** 由结果行构建柱（支持误差棒类型、显著性模式与名称覆盖）。 */
export function buildBarsForGene(
  geneResults: SampleTargetResult[],
  opts: ChartOptions,
  colorFor: (r: SampleTargetResult) => string,
): ChartBar[] {
  return geneResults.map((r) => {
    const { mean, err } = meanAndError(r.fcValues, opts.errorBar);
    const pAdj = r.pAdjusted ?? null;
    const stars = significanceStars(pAdj ?? r.pValue);
    return {
      sample: r.sample,
      label: opts.labelOverrides[r.sample]?.trim() || r.sample,
      target: r.target,
      value: mean,
      err,
      isControl: r.isControl,
      color: colorFor(r),
      p: r.pValue,
      pAdj,
      stars,
    };
  });
}

/** 显著性标注文本（应用显示模式）。 */
export function annotationText(opts: ChartOptions, bar: ChartBar): string | null {
  const p = bar.pAdj ?? bar.p;
  const stars = bar.stars;
  if (opts.showP === 'none') return null;
  if (opts.showP === 'stars') return stars || null;
  if (opts.showP === 'p') return p != null ? 'p=' + formatP(p) : null;
  const star = stars && stars !== 'ns' ? stars : stars === 'ns' ? 'ns' : '';
  const pv = p != null ? 'p=' + formatP(p) : '';
  return (star + (star && pv ? ' ' : '') + pv) || null;
}
