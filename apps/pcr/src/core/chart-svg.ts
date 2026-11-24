import { annotationText, type ChartBar } from './chart-bars';
import { createYAxisBreakScale, getYAxisBreakError, Y_AXIS_BREAK_GAP } from './chart-break';
import type { ChartOptions } from './chart-options';

export interface SegmentInput { gene: string; bars: ChartBar[]; }

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
function textWidth(text: string, size: number): number {
  // 保守估计标签空间；实际文字由浏览器使用所选字体排版。
  return Array.from(text).reduce((width, char) => width + (
    /[^\u0000-\u024f]/.test(char) ? 1.05 : /[MW@%#]/.test(char) ? 0.9 :
      /[ilI|!.,:;' ]/.test(char) ? 0.32 : /[rtf-]/.test(char) ? 0.42 : 0.62
  ) * size, 0);
}

/** 文字和柱体所需最小宽度；正常尺寸沿用用户选择的宽高比例。 */
export function computeChartWidth(segments: SegmentInput[], opts: { groupWidth: number; fontSize: number }): number {
  const size = clamp(opts.fontSize, 8, 28, 12);
  const group = clamp(opts.groupWidth, 0.2, 1, 0.8);
  const active = segments.filter((segment) => segment.bars.length > 0);
  const maxBars = Math.max(1, ...active.map((segment) => segment.bars.length));
  const minSlot = active.length > 1
    ? Math.max(size * 1.8, maxBars * 5 / group + 12)
    : maxBars * (size * 1.2 + 5) / group;
  return Math.ceil(Math.max(400, 100 + Math.max(1, active.length) * minSlot));
}

/** 断轴省略中间区间，上下两段分别保留柱体和误差棒。 */
export function multiGeneChartSvg(segments: SegmentInput[], opts: ChartOptions, accessibleLabel = 'chart'): string {
  const active = segments.filter((segment) => segment.bars.length > 0);
  const multi = active.length > 1;
  const fontSize = clamp(opts.fontSize, 8, 28, 12);
  const fs = (px: number) => Math.round(px * fontSize / 12 * 100) / 100;
  const ff = opts.fontFamily === 'Times New Roman' ? "'Times New Roman', serif"
    : opts.fontFamily === 'Arial' ? 'Arial, sans-serif' : 'sans-serif';
  const groupWidth = clamp(opts.groupWidth, 0.2, 1, 0.8);
  const imageScale = clamp(opts.imageScale ?? 1, 0.5, 2, 1);
  const title = opts.title || (!multi ? active[0]?.gene ?? '' : '');
  const labelSize = multi ? fs(12.5) : fs(11.5);
  const useLog = opts.yScale !== 'linear';
  const dataValues = active.flatMap((segment) => segment.bars.flatMap((bar) => [bar.value, bar.value + bar.err, bar.value - bar.err]))
    .filter(Number.isFinite);
  const positiveValues = dataValues.filter((value) => value > 0);
  const dataMax = Math.max(1e-6, ...dataValues);
  const dataMin = positiveValues.length ? Math.min(...positiveValues) : 0.5;
  let yMin = opts.yMin != null && Number.isFinite(opts.yMin) ? opts.yMin : 0;
  let yMax = opts.yMax != null && Number.isFinite(opts.yMax) && opts.yMax > yMin
    ? opts.yMax : niceCeil(Math.max(dataMax * 1.18, yMin + 1));
  if (useLog) {
    yMin = yMin > 0 ? yMin : Math.pow(2, Math.floor(Math.log2(Math.max(dataMin * 0.6, 0.000001))));
    yMax = opts.yMax != null && Number.isFinite(opts.yMax) && opts.yMax > yMin
      ? opts.yMax : Math.pow(opts.yScale === 'log2' ? 2 : 10, Math.ceil(log(Math.max(dataMax * 1.3, yMin * 2), opts.yScale)));
  }
  const brk = !useLog && opts.yBreak && !getYAxisBreakError(opts.yBreak, yMin) ? opts.yBreak : null;
  const legendItems: { label: string; color: string }[] = [];
  if (multi && opts.legendPosition !== 'none') {
    for (const segment of active) for (const bar of segment.bars) {
      if (!legendItems.some((item) => item.label === bar.label)) legendItems.push({ label: bar.label, color: bar.color });
    }
  }
  const legendPosition = opts.legendPosition ?? 'right';
  const sideLegend = legendItems.length > 0 && (legendPosition === 'left' || legendPosition === 'right');
  const legendFont = fs(11);
  const swatch = fs(11);
  const legendRow = Math.max(swatch, legendFont) * 1.45 + 8;
  const legendWidths = legendItems.map((item) => swatch + 8 + textWidth(item.label, legendFont) + 18);
  const sideLegendWidth = sideLegend ? Math.max(...legendWidths) : 0;
  const sideLegendHeight = sideLegend ? legendItems.length * legendRow : 0;
  const tickSize = fs(11.5);
  const tickWidth = Math.max(...[yMin, yMax, brk?.bottomMax ?? 0, brk?.topMin ?? 0, brk?.topMax ?? 0]
    .map((value) => textWidth(fmtTick(value), tickSize)));
  const axisLeft = Math.max(64, tickWidth + 20 + (opts.yLabel ? fs(12.5) + 14 : 0));
  const left = axisLeft + (sideLegend && legendPosition === 'left' ? sideLegendWidth + 16 : 0);
  const right = 24 + (sideLegend && legendPosition === 'right' ? sideLegendWidth + 16 : 0);
  const requestedW = Number.isFinite(opts.width) ? Math.max(400, opts.width) : 860;
  const requestedH = Number.isFinite(opts.height) ? Math.max(260, opts.height) : 460;
  let titleY = 0;
  let subtitleY = 0;
  let headerBottom = 12;
  if (title) { titleY = headerBottom + fs(17); headerBottom = titleY + 8; }
  if (opts.subtitle) { subtitleY = headerBottom + fs(12); headerBottom = subtitleY + 10; }
  const headingWidth = left + 24 + Math.max(textWidth(title, fs(17)), textWidth(opts.subtitle, fs(12)));
  const minPlotW = computeChartWidth(active, { groupWidth, fontSize }) - 100;
  let factor = Math.max(1, (left + right + minPlotW) / requestedW, headingWidth / requestedW);
  let W = requestedW * factor;
  let H = requestedH * factor;
  let plotW = 0;
  let plotH = 0;
  let top = 0;
  let bottomSpace = 0;
  let labelDepth = 0;
  let rotateLabels = false;
  let horizontalLegendHeight = 0;
  let legendRows: { item: number; x: number; row: number }[] = [];
  const longestLabel = Math.max(0, ...active.flatMap((segment) => multi
    ? [textWidth(segment.gene, labelSize)] : segment.bars.map((bar) => textWidth(short(bar.label), labelSize))));

  // 需要额外空间时整体等比放大，保持用户选择的宽高比例。
  for (let attempt = 0; attempt < 3; attempt++) {
    plotW = W - left - right;
    const slotWidth = plotW / Math.max(1, active.length);
    const groupSpan = Math.max(1, slotWidth - (multi ? 12 : 0)) * groupWidth;
    const barStep = groupSpan / Math.max(1, active[0]?.bars.length ?? 1);
    rotateLabels = longestLabel + 10 > (multi ? slotWidth : barStep);
    labelDepth = rotateLabels ? 16 + longestLabel + labelSize * 0.3 : 12 + labelSize * 1.25;
    legendRows = [];
    let row = 0;
    let x = 0;
    if (!sideLegend) legendWidths.forEach((width, item) => {
      if (x > 0 && x + width > plotW) { row++; x = 0; }
      legendRows.push({ item, x, row });
      x += width;
    });
    horizontalLegendHeight = !sideLegend && legendItems.length ? (row + 1) * legendRow : 0;
    top = headerBottom + 14 + (legendPosition === 'top' ? horizontalLegendHeight + 10 : 0);
    bottomSpace = labelDepth + 18 + (opts.xLabel ? fs(12.5) + 16 : 0)
      + (legendPosition === 'bottom' ? horizontalLegendHeight + 12 : 0);
    let minPlotH = Math.max(120, sideLegendHeight, opts.yLabel ? textWidth(opts.yLabel, fs(12.5)) + 8 : 0);
    if (brk) {
      const minBandHeight = Math.max(36, tickSize * 1.8);
      minPlotH = Math.max(minPlotH, Y_AXIS_BREAK_GAP + minBandHeight / Math.min(brk.bottomPct / 100, 1 - brk.bottomPct / 100));
    }
    const requiredH = top + bottomSpace + minPlotH;
    if (H + 0.01 >= requiredH) break;
    factor = requiredH / requestedH;
    W = requestedW * factor;
    H = requestedH * factor;
  }
  plotW = W - left - right;
  plotH = H - top - bottomSpace;
  const plotBottom = top + plotH;
  const brokenScale = brk ? createYAxisBreakScale(brk, yMin, top, plotH) : null;
  const toY = (value: number): number => brokenScale ? brokenScale.toY(value)
    : top + plotH - (useLog ? (log(value, opts.yScale) - log(yMin, opts.yScale)) / (log(yMax, opts.yScale) - log(yMin, opts.yScale))
      : (value - yMin) / (yMax - yMin)) * plotH;
  const visibleValue = (value: number) => brokenScale ? brokenScale.isVisible(value) : value >= yMin && value <= yMax;
  const tickValues: number[] = brokenScale && brk
    ? [...linearTicks(yMin, brk.bottomMax, brokenScale.lowerHeight, tickSize), ...linearTicks(brk.topMin, brk.topMax, brokenScale.upperHeight, tickSize)]
    : useLog ? logTicks(yMin, yMax, opts.yScale) : linearTicks(yMin, yMax, plotH, tickSize);
  const clipId = 'plotclip' + Math.round(Math.random() * 1e6);
  const clipRects = brokenScale
    ? `<rect x="${left}" y="${brokenScale.gapBottom}" width="${plotW}" height="${brokenScale.lowerHeight}"/><rect x="${left}" y="${top}" width="${plotW}" height="${brokenScale.upperHeight}"/>`
    : `<rect x="${left}" y="${top}" width="${plotW}" height="${plotH}"/>`;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W * imageScale}" height="${H * imageScale}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(accessibleLabel)}">`,
    `<defs><clipPath id="${clipId}">${clipRects}</clipPath></defs>`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
  ];
  const text = (x: number, y: number, value: string, size: number, extra = '') =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="#1d2b32" font-family="${ff}" ${extra}>${esc(value)}</text>`;
  if (title) parts.push(text(left, titleY, title, fs(17), 'font-weight="700" class="chart-title"'));
  if (opts.subtitle) parts.push(text(left, subtitleY, opts.subtitle, fs(12), 'class="chart-subtitle"'));
  for (const value of tickValues) parts.push(text(left - 10, toY(value) + tickSize * 0.35, fmtTick(value), tickSize, 'text-anchor="end" class="chart-y-tick"'));
  if (opts.yLabel) {
    const x = left - axisLeft + fs(12.5);
    const y = top + plotH / 2;
    parts.push(text(x, y, opts.yLabel, fs(12.5), `text-anchor="middle" transform="rotate(-90 ${x} ${y})" class="chart-y-label"`));
  }
  parts.push('<g class="chart-y-axis" stroke="#1d2b32" stroke-width="1.2">');
  if (brokenScale) {
    parts.push(`<line x1="${left}" x2="${left}" y1="${top}" y2="${brokenScale.gapTop}"/>`,
      `<line x1="${left}" x2="${left}" y1="${brokenScale.gapBottom}" y2="${plotBottom}"/>`);
  } else parts.push(`<line x1="${left}" x2="${left}" y1="${top}" y2="${plotBottom}"/>`);
  parts.push('</g>', `<line x1="${left}" x2="${W - right}" y1="${plotBottom}" y2="${plotBottom}" stroke="#1d2b32" stroke-width="1.2"/>`);
  if (brokenScale) {
    const middle = (brokenScale.gapTop + brokenScale.gapBottom) / 2;
    parts.push('<g class="chart-axis-break" stroke="#1d2b32" stroke-width="1.4">',
      `<line x1="${left - 5}" x2="${left + 5}" y1="${middle - 1}" y2="${middle - 5}"/>`,
      `<line x1="${left - 5}" x2="${left + 5}" y1="${middle + 5}" y2="${middle + 1}"/>`, '</g>');
  } else if (!useLog && dataMax > yMax + 1e-9) {
    parts.push(`<path d="M ${left - 5} ${top + 8} l 10 -4 M ${left - 5} ${top + 15} l 10 -4" fill="none" stroke="#1d2b32" stroke-width="1.4"/>`);
  }

  const axisLabels: string[] = [];
  const addAxisLabel = (x: number, value: string) => {
    const y = plotBottom + (rotateLabels ? 14 : 10 + labelSize);
    axisLabels.push(text(x, y, value, labelSize, rotateLabels
      ? `text-anchor="end" dominant-baseline="central" transform="rotate(-90 ${x} ${y})"`
      : 'text-anchor="middle"'));
  };
  parts.push(`<g class="chart-data" clip-path="url(#${clipId})">`);
  active.forEach((segment, index) => {
    const slot = plotW / active.length;
    const middle = left + (index + 0.5) * slot;
    const clusterWidth = Math.max(1, slot - (multi ? 12 : 0)) * groupWidth;
    const barStep = clusterWidth / segment.bars.length;
    const barW = multi ? barStep : barStep * 0.8;
    const start = middle - clusterWidth / 2;
    const centers: number[] = [];
    const tops: number[] = [];
    segment.bars.forEach((bar, i) => {
      const cx = start + (i + 0.5) * barStep;
      centers.push(cx);
      const value = Number.isFinite(bar.value) ? bar.value : yMin;
      const error = opts.errorBar !== 'none' && Number.isFinite(bar.err) ? Math.max(0, bar.err) : 0;
      const y = toY(Math.max(yMin, value));
      const hi = value + error;
      const lo = value - error;
      const yTop = toY(Math.max(yMin, hi));
      const yBot = toY(Math.max(yMin, lo));
      tops.push(Math.min(yTop, y));
      parts.push(`<rect class="chart-bar" x="${cx - barW / 2}" y="${y}" width="${barW}" height="${Math.max(0, plotBottom - y)}" fill="${bar.color}" stroke="#1d2b32" stroke-width="1"/>`);
      if (error > 0) {
        const half = Math.min(barW * 0.28, fs(12));
        parts.push(`<g class="chart-error-bar" stroke="#1d2b32" stroke-width="1.3"><line x1="${cx}" x2="${cx}" y1="${yTop}" y2="${yBot}"/>`);
        if (visibleValue(hi)) parts.push(`<line x1="${cx - half}" x2="${cx + half}" y1="${yTop}" y2="${yTop}"/>`);
        if (visibleValue(lo)) parts.push(`<line x1="${cx - half}" x2="${cx + half}" y1="${yBot}" y2="${yBot}"/>`);
        parts.push('</g>');
      }
      if (!multi) addAxisLabel(cx, short(bar.label));
    });
    const control = segment.bars.findIndex((bar) => bar.isControl);
    if (control >= 0 && opts.showP !== 'none') {
      let level = 0;
      segment.bars.forEach((bar, i) => {
        if (bar.isControl) return;
        const note = annotationText(opts, bar);
        if (!note) return;
        const xL = centers[control];
        const xR = centers[i];
        let y = Math.max(top + fs(13) + 8, Math.min(tops[control], tops[i]) - 8 - level * fs(18));
        if (brokenScale && y + 6 > brokenScale.gapTop && y - fs(13) - 4 < brokenScale.gapBottom) y = brokenScale.gapTop - 8;
        parts.push(`<path class="chart-significance" d="M ${xL} ${y + 6} L ${xL} ${y} L ${xR} ${y} L ${xR} ${y + 6}" fill="none" stroke="#1d2b32" stroke-width="1.3"/>`,
          text((xL + xR) / 2, y - 4, note, fs(13), 'text-anchor="middle" font-weight="600"'));
        level++;
      });
    }
    if (multi) addAxisLabel(middle, segment.gene);
  });
  parts.push('</g>', '<g class="chart-axis-labels">', ...axisLabels, '</g>');
  let footerY = plotBottom + labelDepth;
  if (opts.xLabel) {
    footerY += fs(12.5) + 10;
    parts.push(text(left + plotW / 2, footerY, opts.xLabel, fs(12.5), 'text-anchor="middle" class="chart-x-label"'));
  }
  if (legendItems.length) {
    parts.push('<g class="chart-legend">');
    const drawItem = (item: number, x: number, y: number) => {
      parts.push(`<rect x="${x}" y="${y}" width="${swatch}" height="${swatch}" fill="${legendItems[item].color}" stroke="#1d2b32" stroke-width="0.8"/>`,
        text(x + swatch + 8, y + swatch * 0.85, legendItems[item].label, legendFont));
    };
    if (sideLegend) {
      const x = legendPosition === 'left' ? 12 : left + plotW + 16;
      const y = top + (plotH - sideLegendHeight) / 2;
      legendItems.forEach((_, item) => drawItem(item, x, y + item * legendRow));
    } else {
      const y = legendPosition === 'top' ? headerBottom + 4 : footerY + 14;
      legendRows.forEach(({ item, x, row }) => drawItem(item, left + x, y + row * legendRow));
    }
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('');
}

function esc(value: string): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function short(value: string): string { return value.length > 14 ? value.slice(0, 13) + '…' : value; }
function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(value));
  for (const multiple of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (multiple * base >= value) return multiple * base;
  return 10 * base;
}
function fmtTick(value: number): string {
  if (value === 0) return '0';
  if (Math.abs(value) >= 10000 || Math.abs(value) < 0.001) return value.toExponential(1).replace('.0e', 'e');
  return String(Number(value.toPrecision(5)));
}
function log(value: number, scale: ChartOptions['yScale']): number { return Math.log(value) / Math.log(scale === 'log2' ? 2 : 10); }
function logTicks(min: number, max: number, scale: ChartOptions['yScale']): number[] {
  const values: number[] = [];
  for (let exponent = Math.ceil(log(min, scale)); exponent <= Math.floor(log(max, scale)); exponent++) values.push((scale === 'log2' ? 2 : 10) ** exponent);
  return values;
}
function linearTicks(min: number, max: number, height: number, fontSize: number): number[] {
  const count = Math.max(2, Math.min(6, Math.floor(height / (fontSize * 2))));
  const step = niceCeil((max - min) / (count - 1));
  const minimumGap = fontSize * 1.6 / height * (max - min);
  const values = [min];
  for (let value = Math.ceil(min / step) * step; value < max && values.length < 20; value += step) {
    if (value - values[values.length - 1] >= minimumGap && max - value >= minimumGap) values.push(value);
  }
  values.push(max);
  return values;
}
