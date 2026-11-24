// 标准曲线：从稀释系列的 Cq ~ log10(浓度) 拟合斜率，换算扩增效率，
// 直接喂给 Pfaffl 校正（用户不必手填效率）。
//   Cq = slope · log10(Q) + intercept（slope 为负，约 −3.1 ~ −3.6）
//   效率% = (10^(−1/slope) − 1) × 100（slope = −3.32 → ≈100%）

import { isNtcRow, isStandardRow, type AnalysisRow } from './analysis';

export interface StandardPoint {
  cq: number;
  quantity: number;
}

export interface StandardCurve {
  slope: number;
  intercept: number;
  r2: number;
  effPct: number;
  n: number;
}

/**
 * 从样本名解析相对数量：
 *   "1:10" → 0.1（稀释比，1/N）；"10^4"/"1e4" → 10000；"Std_100000" → 100000；
 *   纯序列号（Std-1/Std-2）解析不出数量级，返回 null（保守不猜）。
 */
export function parseQuantityFromName(name: string): number | null {
  const s = name.trim().toLowerCase();
  let m = /(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/.exec(s);
  if (m) {
    const dil = Number(m[2]);
    if (dil > 0) return 1 / dil;
  }
  m = /10\s*\^\s*(\d+)/.exec(s);
  if (m) return Math.pow(10, Number(m[1]));
  m = /1e(\d+)/.exec(s);
  if (m) return Math.pow(10, Number(m[1]));
  m = /(\d{2,}(?:\.\d+)?)/.exec(s);
  if (m) {
    const v = Number(m[1]);
    if (v >= 10) return v;
  }
  return null;
}

/** 普通最小二乘拟合；点数 <3 或浓度无变化返回 null。 */
export function fitStandardCurve(points: StandardPoint[]): StandardCurve | null {
  const pts = points.filter((p) => Number.isFinite(p.cq) && Number.isFinite(p.quantity) && p.quantity > 0);
  const n = pts.length;
  if (n < 3) return null;
  const x = pts.map((p) => Math.log10(p.quantity));
  const y = pts.map((p) => p.cq);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) * (x[i] - mx);
    sxy += (x[i] - mx) * (y[i] - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * x[i] + intercept;
    ssRes += (y[i] - pred) * (y[i] - pred);
    ssTot += (y[i] - my) * (y[i] - my);
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  if (slope >= 0) return null; // 斜率为正说明浓度方向反了或数据无意义
  const effPct = (Math.pow(10, -1 / slope) - 1) * 100;
  return { slope, intercept, r2, effPct, n };
}

/** 收集各基因的标准曲线点：Task=STANDARD/名字 Std 惯例的行，数量优先取 quantity 列，否则解析样本名。 */
export function collectStandardPoints(rows: AnalysisRow[]): Map<string, StandardPoint[]> {
  const byGene = new Map<string, StandardPoint[]>();
  for (const r of rows) {
    if (r.excluded || isNtcRow(r) || !isStandardRow(r)) continue;
    if (!r.target || !Number.isFinite(r.cq)) continue;
    const q = Number.isFinite(r.quantity) && r.quantity > 0 ? r.quantity : parseQuantityFromName(r.sample);
    if (q == null) continue;
    byGene.set(r.target, [...(byGene.get(r.target) ?? []), { cq: r.cq, quantity: q }]);
  }
  return byGene;
}

/** 拟合全部基因，返回可通过质检（n、R²）的曲线。 */
export function fitAllStandardCurves(
  rows: AnalysisRow[],
  opts: { minPoints?: number; minR2?: number } = {},
): Map<string, StandardCurve> {
  const minPoints = opts.minPoints ?? 3;
  const minR2 = opts.minR2 ?? 0;
  const out = new Map<string, StandardCurve>();
  for (const [gene, points] of collectStandardPoints(rows)) {
    const curve = fitStandardCurve(points);
    if (curve && curve.n >= minPoints && curve.r2 >= minR2) out.set(gene, curve);
  }
  return out;
}
