import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeMeltCurve, summarizeMeltByGene, type MeltPoint } from './melt';
import { parseRdml } from './rdml';

const here = fileURLToPath(new URL('.', import.meta.url));

/** 教科书熔解曲线：基线 + S 型骤降（sigmoid），可带噪声 */
function synthCurve(drops: { center: number; depth: number; sharp?: number }[], noise = 0): MeltPoint[] {
  const pts: MeltPoint[] = [];
  for (let t = 60; t <= 95; t++) {
    let v = 100 + (t - 60) * 0.2;
    for (const d of drops) v += d.depth / (1 + Math.exp((t - d.center) * (d.sharp ?? 1.5)));
    if (noise > 0) v += Math.sin(t * 7.3) * noise;
    pts.push({ tmp: t, fluor: v });
  }
  return pts;
}

describe('熔解峰检测', () => {
  it('单峰（80°C）正确识别', () => {
    const q = analyzeMeltCurve(synthCurve([{ center: 80, depth: 80 }]));
    expect(q.peaks).toBe(1);
    expect(Math.abs(q.tm! - 80)).toBeLessThanOrEqual(1);
  });
  it('双峰（72 + 86°C）识别为 2 峰，主峰为幅值更大者', () => {
    const q = analyzeMeltCurve(synthCurve([{ center: 72, depth: 60 }, { center: 86, depth: 40 }]));
    expect(q.peaks).toBe(2);
    expect(Math.abs(q.tm! - 72)).toBeLessThanOrEqual(1);
  });
  it('纯噪声/缓坡 → 0 峰', () => {
    const pts: MeltPoint[] = [];
    let v = 100;
    for (let t = 60; t <= 95; t++) {
      v += Math.sin(t * 7.3) * 2 + (t - 60) * 0.1;
      pts.push({ tmp: t, fluor: v });
    }
    expect(analyzeMeltCurve(pts).peaks).toBe(0);
  });
  it('60°C 以下的波动不计峰', () => {
    const pts: MeltPoint[] = [];
    for (let t = 45; t < 60; t += 1) {
      pts.push({ tmp: t, fluor: 100 + Math.sin(t * 5) * 30 });
    }
    pts.push(...synthCurve([{ center: 80, depth: 80 }]));
    const q = analyzeMeltCurve(pts);
    expect(q.tm!).toBeGreaterThanOrEqual(60);
  });
  it('点数不足 → 0 峰', () => {
    expect(analyzeMeltCurve([{ tmp: 80, fluor: 100 }, { tmp: 81, fluor: 90 }, { tmp: 82, fluor: 50 }]).peaks).toBe(0);
  });
});

describe('真实 RDML 熔解数据（Bio-Rad，60 孔）', () => {
  const bytes = new Uint8Array(readFileSync(join(here, '../../tests/fixtures/real/BioRad_qPCR_melt.rdml')));
  const parsed = parseRdml(bytes);
  const summaries = summarizeMeltByGene(parsed.meltCurves);

  it('4 个靶标、60 条曲线全部被检测', () => {
    expect(summaries).toHaveLength(4);
    expect(summaries.reduce((s, m) => s + m.checked, 0)).toBe(60);
  });
  it('保守阈值下 Cy5 单峰孔识别且无误报多峰', () => {
    const cy5 = summaries.find((m) => m.gene === 'Cy5')!;
    expect(cy5.checked).toBe(10);
    expect(cy5.single).toBeGreaterThanOrEqual(3);
    expect(cy5.multi).toHaveLength(0);
  });
  it('低质量浅曲线（EvaGreen）判为无明确峰而非误报', () => {
    const eva = summaries.find((m) => m.gene === 'EvaGreen')!;
    expect(eva.checked).toBe(30);
    expect(eva.none + eva.single).toBe(30); // 不产生多峰误报
  });
});
