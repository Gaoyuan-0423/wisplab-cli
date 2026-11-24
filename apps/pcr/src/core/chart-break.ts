import type { ChartOptions } from './chart-options';

export type YAxisBreak = NonNullable<ChartOptions['yBreak']>;
export const Y_AXIS_BREAK_GAP = 18;

/** 返回可直接显示给用户的配置错误；未开启断轴不算错误。 */
export function getYAxisBreakError(yBreak: ChartOptions['yBreak'], yMin = 0): string | null {
  if (!yBreak) return null;
  const { bottomMax, topMin, topMax, bottomPct } = yBreak;
  if (![yMin, bottomMax, topMin, topMax, bottomPct].every(Number.isFinite)) return '断轴范围和高度比例必须是有限数值。';
  if (!(yMin < bottomMax && bottomMax < topMin && topMin < topMax)) {
    return '断轴范围须满足：Y 轴下限 < 省略区间起点 < 省略区间终点 < 上段上限。';
  }
  if (bottomPct < 10 || bottomPct > 90) return '下段高度比例须在 10%–90% 之间。';
  return null;
}

/** 在相邻观测值的最大空隙中推荐省略区间；调用方应包含均值和误差端点。 */
export function suggestYAxisBreak(values: number[], yMin = 0): YAxisBreak {
  const lower = Number.isFinite(yMin) ? yMin : 0;
  const sorted = [...new Set(values.filter((v) => Number.isFinite(v) && v > lower))].sort((a, b) => a - b);
  if (sorted.length === 0) return { bottomMax: lower + 10, topMin: lower + 30, topMax: lower + 50, bottomPct: 70 };
  let gapLo = sorted.length > 1 ? sorted[0] : lower;
  let gapHi = sorted.length > 1 ? sorted[1] : sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > gapHi - gapLo) {
      gapLo = sorted[i - 1];
      gapHi = sorted[i];
    }
  }
  const gap = gapHi - gapLo;
  const max = sorted[sorted.length - 1];
  const bottomMax = gapLo + gap * 0.2;
  const topMin = gapHi - gap * 0.2;
  const topMax = max + Math.max((max - lower) * 0.18, gap * 0.2);
  const recommendation = { bottomMax: tidy(bottomMax), topMin: tidy(topMin), topMax: tidy(topMax), bottomPct: 70 };
  // 四位有效数字便于修改；极窄数据间隙舍入后可能合并，必要时保留原精度。
  return !getYAxisBreakError(recommendation, lower) && recommendation.bottomMax > gapLo && recommendation.topMin < gapHi
    && recommendation.topMax >= max
    ? recommendation : { bottomMax, topMin, topMax, bottomPct: 70 };
}

function tidy(value: number): number {
  return Number(value.toPrecision(4));
}

/** 两段线性轴的连续映射：被省略的数值只映射到物理留白，随后由 clipPath 排除。 */
export function createYAxisBreakScale(yBreak: YAxisBreak, yMin: number, top: number, height: number) {
  if (getYAxisBreakError(yBreak, yMin) || !Number.isFinite(top) || !Number.isFinite(height) || height <= Y_AXIS_BREAK_GAP) return null;
  const { bottomMax, topMin, topMax, bottomPct } = yBreak;
  const lowerHeight = (height - Y_AXIS_BREAK_GAP) * bottomPct / 100;
  const upperHeight = height - Y_AXIS_BREAK_GAP - lowerHeight;
  const gapTop = top + upperHeight;
  const gapBottom = gapTop + Y_AXIS_BREAK_GAP;
  const bottom = top + height;
  return {
    top, bottom, gapTop, gapBottom, lowerHeight, upperHeight,
    toY(value: number): number {
      if (value <= bottomMax) return bottom - (value - yMin) / (bottomMax - yMin) * lowerHeight;
      if (value >= topMin) return gapTop - (value - topMin) / (topMax - topMin) * upperHeight;
      return gapBottom - (value - bottomMax) / (topMin - bottomMax) * Y_AXIS_BREAK_GAP;
    },
    isVisible(value: number): boolean {
      return (value >= yMin && value <= bottomMax) || (value >= topMin && value <= topMax);
    },
  };
}
