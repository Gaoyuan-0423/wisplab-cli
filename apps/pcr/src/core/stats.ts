// 统计数值实现：Welch t 检验与单因素 ANOVA。
// p 值经由正则化不完全 beta 函数（Lanczos lgamma + 连分式），对照标准统计表验证。

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** 样本标准差（n-1）；n<2 返回 NaN。 */
export function sd(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) * (x - m);
  return Math.sqrt(v / (n - 1));
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function lgamma(x: number): number {
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** 正则化不完全贝塔函数 I_x(a, b)。 */
export function betaInc(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Student t 分布的单侧累积概率 P(T ≤ t)。 */
export function studentTCdf(t: number, df: number): number {
  if (df <= 0) return NaN;
  const x = df / (df + t * t);
  const p = 0.5 * betaInc(df / 2, 0.5, x);
  return t > 0 ? 1 - p : p;
}

/** F 分布的累积概率 P(F ≤ f)。 */
export function fCdf(f: number, df1: number, df2: number): number {
  if (f < 0 || df1 <= 0 || df2 <= 0) return NaN;
  const x = (df1 * f) / (df1 * f + df2);
  return betaInc(df1 / 2, df2 / 2, x);
}

export interface TTestResult {
  t: number;
  df: number;
  p: number;
}

/** Welch t 检验（双侧，方差不齐），返回 t 统计量、Welch–Satterthwaite 自由度与 p 值。 */
export function welchTTest(a: number[], b: number[]): TTestResult {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 < 2 || n2 < 2) return { t: NaN, df: NaN, p: NaN };
  const m1 = mean(a);
  const m2 = mean(b);
  const v1 = sd(a) ** 2;
  const v2 = sd(b) ** 2;
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  if (!Number.isFinite(se) || se === 0) return { t: 0, df: n1 + n2 - 2, p: 1 };
  const t = (m1 - m2) / se;
  const num = (v1 / n1 + v2 / n2) ** 2;
  const den = (v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1);
  const df = den > 0 ? num / den : n1 + n2 - 2;
  // P(|T_df| >= |t|) = I_{df/(df+t²)}(df/2, 1/2).
  // Evaluate the tail directly: subtracting a CDF rounded to 1 loses small p values.
  const p = betaInc(df / 2, 0.5, df / (df + t * t));
  return { t, df, p: Math.min(1, Math.max(0, p)) };
}

export interface AnovaResult {
  f: number;
  df1: number;
  df2: number;
  p: number;
  /** 组内均方（MSE），供 Dunnett 的合并标准差使用 */
  msWithin: number;
}

/** 单因素 ANOVA；组数 <2 或总样本 ≤ 组数时返回 NaN。 */
export function oneWayAnova(groups: number[][]): AnovaResult {
  const gs = groups.filter((g) => g.length > 0);
  const k = gs.length;
  const n = gs.reduce((s, g) => s + g.length, 0);
  if (k < 2 || n <= k) return { f: NaN, df1: NaN, df2: NaN, p: NaN, msWithin: NaN };
  const all = gs.flat();
  const grand = mean(all);
  let ssb = 0;
  let ssw = 0;
  for (const g of gs) {
    const m = mean(g);
    ssb += g.length * (m - grand) * (m - grand);
    for (const x of g) ssw += (x - m) * (x - m);
  }
  const df1 = k - 1;
  const df2 = n - k;
  const msb = ssb / df1;
  const msw = ssw / df2;
  if (msw === 0) return { f: 0, df1, df2, p: 1, msWithin: 0 };
  const f = msb / msw;
  const p = 1 - fCdf(f, df1, df2);
  return { f, df1, df2, p: Math.min(1, Math.max(0, p)), msWithin: msw };
}

export function significanceStars(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return '';
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return 'ns';
}

export function formatP(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return '-';
  if (p < 0.0001) return '<0.0001';
  return p.toFixed(4);
}

// ── Dunnett 多重比较（与共用对照）──

/** 误差函数（Abramowitz–Stegun 7.1.26，|err| ≤ 1.5e-7）。 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** 正则化下不完全伽马函数 P(a, x)（级数 + 连分式）。 */
export function lowerGammaInc(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    // 级数
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  // 连分式（Lentoni），计算 Q 再取 1-Q
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
  return 1 - q;
}

/** 卡方分布累积概率。 */
export function chiSquareCdf(x: number, df: number): number {
  if (x <= 0 || df <= 0) return 0;
  return lowerGammaInc(df / 2, x / 2);
}

/** 卡方分布分位数（二分法）。 */
export function chiSquareQuantile(q: number, df: number): number {
  if (q <= 0) return 0;
  if (q >= 1) return Infinity;
  let lo = 0;
  let hi = df * 60 + 200;
  for (let i = 0; i < 120; i++) {
    const mid = (lo + hi) / 2;
    if (chiSquareCdf(mid, df) < q) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

interface GLNode {
  x: number;
  w: number;
}

/** Gauss–Legendre 节点与权重（牛顿迭代求 Legendre 多项式零点）。 */
export function gaussLegendre(n: number, a: number, b: number): GLNode[] {
  const nodes: GLNode[] = [];
  const m = (n + 1) / 2;
  for (let i = 1; i <= m; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let pp = 0;
    for (let iter = 0; iter < 100; iter++) {
      let p1 = 1;
      let p2 = 0;
      for (let j = 1; j <= n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const z1 = z;
      z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    const xl = (b - a) / 2;
    const xm = (a + b) / 2;
    const w = (2 * xl) / ((1 - z * z) * pp * pp);
    nodes.push({ x: xm - xl * z, w });
    nodes.push({ x: xm + xl * z, w });
  }
  return nodes;
}

const GL_N_U = gaussLegendre(40, -9, 9); // 对照组潜变量
// 内层在 χ² 变量 v 域分面板求积：S = σ·√(v/ν)，权重含 χ² 密度 v^{ν/2−1}e^{−v/2}，被积函数在 v 域光滑。
// 分位数坐标在 |t| 大时于 q≈0 处出现宽度 O(1/t) 的边界层，固定节点会整体漏掉，
// 使深尾部校正 p 偏小可达 6 个数量级以上（真实数据实测），故弃用；
// v 域积分上限随 |t| 自适应收紧到尾概率亏缺 ≤ 2Φ(−8) 处，面板始终对准有效支撑区。
const GL_V_PANELS = 40;
const GL_N_V = gaussLegendre(16, -1, 1);

/** 卡方密度（Dunnett 内层积分的变量替换权重）。 */
function chiSquarePdf(v: number, df: number): number {
  if (v <= 0) return 0;
  return Math.exp((df / 2 - 1) * Math.log(v) - v / 2 - (df / 2) * Math.LN2 - lgamma(df / 2));
}

/**
 * Dunnett 校正 p 值（双侧，共用对照组）。
 * 输入每个处理组 vs 对照组的 |t| 与 b_j = sqrt(n_j / n_0)，以及混合自由度 df。
 * 通过二元高斯求积对多元 t 的最大绝对值分布积分（Dunnett 1955/1989 的单因子结构）。
 * 直接积分尾概率（而非 1 − 通过概率），避免深尾部 p ≪ 1 时的减法精度损失。
 */
export function dunnettAdjustedP(
  comparisons: { b: number; tAbs: number }[],
  df: number,
): number[] {
  const k = comparisons.length;
  if (k === 0 || df <= 0) return comparisons.map(() => NaN);
  const out: number[] = new Array(k).fill(0);
  const bMax = Math.max(...comparisons.map((cmp) => cmp.b));
  for (let i = 0; i < k; i++) {
    const c = comparisons[i].tAbs;
    if (!Number.isFinite(c)) {
      out[i] = NaN;
      continue;
    }
    // 截断点：v 超过它时任何 u∈[−9,9] 下窗口亏缺 ≤ 2Φ(−8)，对尾概率的贡献可忽略
    const rMin = Math.min(...comparisons.map((cmp) => Math.sqrt(1 + cmp.b * cmp.b)));
    const sCut = (8 + bMax * 9) / (c * rMin);
    const vCut = Math.max(df * sCut * sCut, df);
    const step = vCut / GL_V_PANELS;
    const half = step / 2;
    const sNodes: { s: number; w: number }[] = [];
    for (let p = 0; p < GL_V_PANELS; p++) {
      const lo = p * step;
      for (const nd of GL_N_V) {
        const v = lo + half * (nd.x + 1);
        sNodes.push({ s: Math.sqrt(v / df), w: half * nd.w * chiSquarePdf(v, df) });
      }
    }
    let tail = 0;
    for (const nu of GL_N_U) {
      let inner = 0;
      for (const ns of sNodes) {
        const s = ns.s;
        let prod = 1;
        for (const cmp of comparisons) {
          // 条件分布：Φ(cS√(1+b²)+bu) − Φ(−cS√(1+b²)+bu)
          const r = Math.sqrt(1 + cmp.b * cmp.b);
          const a = s * c * r;
          const off = cmp.b * nu.x;
          prod *= normalCdf(a + off) - normalCdf(-a + off);
          if (prod === 0) break;
        }
        inner += ns.w * (1 - prod);
      }
      tail += nu.w * normalPdf(nu.x) * inner;
    }
    out[i] = Math.min(1, Math.max(0, tail));
  }
  return out;
}

function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}
