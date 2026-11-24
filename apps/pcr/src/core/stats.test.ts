import { describe, expect, it } from 'vitest';
import {
  betaInc,
  dunnettAdjustedP,
  erf,
  fCdf,
  lowerGammaInc,
  mean,
  oneWayAnova,
  sd,
  significanceStars,
  studentTCdf,
  welchTTest,
  chiSquareCdf,
  chiSquareQuantile,
} from './stats';

describe('基础统计量', () => {
  it('均值与样本标准差对照手算值', () => {
    expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
    expect(sd([3])).toBeNaN();
  });
});

describe('t 分布累积概率（对照统计表）', () => {
  it('t=2.228139, df=10 → CDF=0.975', () => {
    expect(studentTCdf(2.228138852, 10)).toBeCloseTo(0.975, 5);
  });
  it('t=1.812461, df=10 → CDF=0.95', () => {
    expect(studentTCdf(1.812461123, 10)).toBeCloseTo(0.95, 5);
  });
  it('对称性：CDF(-t) = 1 - CDF(t)', () => {
    const t = 1.5;
    expect(studentTCdf(-t, 8)).toBeCloseTo(1 - studentTCdf(t, 8), 10);
  });
});

describe('F 分布累积概率（对照统计表）', () => {
  it('F=3.238872, df=3/16 → CDF=0.95', () => {
    expect(fCdf(3.238871524, 3, 16)).toBeCloseTo(0.95, 4);
  });
  it('F=4.256495, df=2/9 → CDF=0.95', () => {
    expect(fCdf(4.256494711, 2, 9)).toBeCloseTo(0.95, 4);
  });
});

describe('不完全贝塔函数', () => {
  it('I_x(2,3) 对照积分值', () => {
    // I_0.5(2,3) = 0.6875（多项式可手算验证）
    expect(betaInc(2, 3, 0.5)).toBeCloseTo(0.6875, 6);
    expect(betaInc(2, 3, 0)).toBe(0);
    expect(betaInc(2, 3, 1)).toBe(1);
  });
});

describe('Welch t 检验', () => {
  it('相同分布两组 → p 大', () => {
    const a = [1.2, 0.9, 1.1, 1.0, 1.3];
    const b = [1.1, 0.8, 1.2, 1.0, 0.9];
    const r = welchTTest(a, b);
    expect(r.p).toBeGreaterThan(0.3);
  });
  it('明显偏移两组 → p 极小，交换两组 p 不变', () => {
    const a = [1.0, 1.1, 0.9, 1.05, 0.95];
    const b = [2.0, 2.1, 1.9, 2.05, 2.15];
    const r1 = welchTTest(a, b);
    const r2 = welchTTest(b, a);
    expect(r1.p).toBeLessThan(0.001);
    expect(r1.p).toBeCloseTo(r2.p, 10);
  });
  // Independent references generated with R 4.5.3 (2026-03-11), base stats:
  // t.test(a, b, alternative = "two.sided", var.equal = FALSE)
  // Store the reference values so CI does not need R or use our own beta implementation as its oracle.
  it.each([
    {
      name: 'ordinary probabilities',
      a: [1.2, 0.9, 1.1, 1.0, 1.3], b: [1.1, 0.8, 1.2, 1.0, 0.9],
      p: 0.34659350708733383, df: 8.000000000000002,
    },
    {
      name: 'deep tail with equal sample sizes and variances',
      a: Array.from({ length: 10 }, (_, i) => 24 + (i - 4.5) * 0.02),
      b: Array.from({ length: 10 }, (_, i) => 20 + (i - 4.5) * 0.02),
      p: 3.2606067405940227e-29, df: 18,
    },
    {
      name: 'deep tail with unequal sample sizes and variances',
      a: [19.95, 19.98, 20, 20.02, 20.05],
      b: [23.82, 23.9, 23.98, 24, 24.02, 24.08, 24.13, 24.21],
      p: 2.7799557536661831e-14, df: 8.90857309134996,
    },
    {
      name: 'representable probability far below machine epsilon',
      a: Array.from({ length: 10 }, (_, i) => 24 + (i - 4.5) * 0.0002),
      b: Array.from({ length: 10 }, (_, i) => 20 + (i - 4.5) * 0.0002),
      p: 3.2836757307965995e-65, df: 18,
    },
    {
      name: 'one constant group and one variable group',
      a: [20, 20, 20], b: [23.98, 24, 24.02],
      p: 8.333229168113051e-6, df: 2,
    },
  ])('matches R Welch reference: $name', ({ a, b, p, df }) => {
    for (const result of [welchTTest(a, b), welchTTest(b, a)]) {
      expect(result.p).toBeGreaterThan(0);
      // Relative error is essential: an absolute tolerance would allow p=0 in deep tails.
      expect(Math.abs(result.p / p - 1)).toBeLessThan(1e-10);
      expect(result.df).toBeCloseTo(df, 10);
    }
  });
  it('preserves equal-mean and legacy zero-variance results', () => {
    expect(welchTTest([1, 2, 3], [1, 2, 3])).toEqual({ t: 0, df: 4, p: 1 });
    expect(welchTTest([2, 2, 2], [2, 2, 2])).toEqual({ t: 0, df: 4, p: 1 });
  });
  it('样本不足 → NaN', () => {
    expect(Number.isNaN(welchTTest([1], [1, 2, 3]).p)).toBe(true);
  });
});

describe('单因素 ANOVA', () => {
  it('组间差异大 → p 小', () => {
    const r = oneWayAnova([
      [1, 1.1, 0.9],
      [2, 2.1, 1.9],
      [3, 3.1, 2.9],
    ]);
    expect(r.p).toBeLessThan(0.01);
    expect(r.df1).toBe(2);
    expect(r.df2).toBe(6);
  });
  it('组间无差异 → p 接近 1', () => {
    const r = oneWayAnova([
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
    ]);
    expect(r.p).toBe(1);
  });
});

describe('显著性星号', () => {
  it('阈值分级', () => {
    expect(significanceStars(0.0001)).toBe('***');
    expect(significanceStars(0.005)).toBe('**');
    expect(significanceStars(0.03)).toBe('*');
    expect(significanceStars(0.2)).toBe('ns');
    expect(significanceStars(null)).toBe('');
  });
});

describe('伽马/卡方基础', () => {
  it('P(0.5, x) = erf(√x)', () => {
    expect(lowerGammaInc(0.5, 1)).toBeCloseTo(erf(1), 6);
    expect(lowerGammaInc(0.5, 2.25)).toBeCloseTo(erf(1.5), 6);
  });
  it('卡方 CDF 关键点与分位数往返', () => {
    expect(chiSquareCdf(3.8414588, 1)).toBeCloseTo(0.95, 5);
    const x = 18.307038;
    expect(chiSquareQuantile(chiSquareCdf(x, 10), 10)).toBeCloseTo(x, 4);
  });
});

describe('Dunnett 校正 p', () => {
  it('k=1 时退化为普通双侧 t 检验 p 值（精确恒等）', () => {
    for (const c of [1.5, 2.5, 3.7]) {
      const pAdj = dunnettAdjustedP([{ b: 1, tAbs: c }], 12)[0];
      const pT = 2 * (1 - studentTCdf(c, 12));
      expect(pAdj).toBeCloseTo(pT, 4);
    }
  });
  it('比较数越多校正越大：p_adj(k=3) ≥ p_adj(k=1)', () => {
    const c = 2.4;
    const p1 = dunnettAdjustedP([{ b: 1, tAbs: c }], 15)[0];
    const p3 = dunnettAdjustedP(
      [
        { b: 1, tAbs: c },
        { b: 1, tAbs: 0.3 },
        { b: 1, tAbs: 0.2 },
      ],
      15,
    )[0];
    expect(p3).toBeGreaterThan(p1);
  });
  it('k=3、df=12 的 0.05 双侧临界值 ≈ 2.68（对照 Dunnett 表）', () => {
    const pAtCrit = dunnettAdjustedP(
      [
        { b: 1, tAbs: 2.68 },
        { b: 1, tAbs: 0.5 },
        { b: 1, tAbs: 0.5 },
      ],
      12,
    )[0];
    expect(pAtCrit).toBeGreaterThan(0.03);
    expect(pAtCrit).toBeLessThan(0.08);
  });
  it('不等样本量也能计算（b 不同）', () => {
    const ps = dunnettAdjustedP(
      [
        { b: Math.sqrt(3 / 6), tAbs: 2.2 },
        { b: Math.sqrt(4 / 6), tAbs: 3.1 },
      ],
      10,
    );
    expect(ps[0]).toBeGreaterThan(ps[1]);
    expect(ps[1]).toBeLessThan(0.1);
  });
  it('深尾部（|t|≈30–60）校正 p 不得低于对应未校正 p（真实数据回归）', () => {
    // 数据取自 tests/fixtures/real/RELATIVE_example.csv 的 ANOVA+Dunnett 路径；
    // 修复前分位数坐标 40 节点漏掉边界层，此处曾输出 6.9e-13（正确量级 ≈3e-6）。
    const b = Math.sqrt(3 / 6);
    const comps = [
      { b, tAbs: 43.89472458428537 },
      { b, tAbs: 33.05605716794532 },
    ];
    const raw1 = 2 * (1 - studentTCdf(comps[0].tAbs, 4));
    const [p1] = dunnettAdjustedP(comps, 4);
    expect(p1).toBeGreaterThanOrEqual(raw1);
    expect(p1).toBeLessThanOrEqual(raw1 * comps.length * 1.01);
    expect(p1).toBeGreaterThan(1.5e-6);
    expect(p1).toBeLessThan(3.4e-6);
    const compsG = [
      { b, tAbs: 50.423130755476315 },
      { b, tAbs: 37.06751312144091 },
    ];
    const rawG = 2 * (1 - studentTCdf(compsG[0].tAbs, 4));
    const [pG1] = dunnettAdjustedP(compsG, 4);
    expect(pG1).toBeGreaterThanOrEqual(rawG);
    expect(pG1).toBeLessThanOrEqual(rawG * compsG.length * 1.01);
  });
});
