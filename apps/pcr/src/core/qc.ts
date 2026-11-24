import type { QcFlags, QcSettings } from './types';
import { sd } from './stats';

export interface QcInputRow {
  id: number;
  sample: string;
  target: string;
  cq: number; // NaN 表示非数值
  excluded: boolean;
}

/**
 * 逐孔 QC 标记：
 * - 缺样本 / 缺基因 / 非数值 Cq
 * - Cq 越界（minCq / maxCq 启用时）
 * - 复孔离群（同样本同基因 ≥3 孔）：绝对偏差超 absDev，或 z 分数超 zScore
 * 已手工剔除的孔不再重复标记。
 */
export function computeQcFlags(rows: QcInputRow[], settings: QcSettings): QcFlags {
  const flags: QcFlags = {};
  const groups = new Map<string, QcInputRow[]>();

  for (const row of rows) {
    const reasons: string[] = [];
    if (!row.sample) reasons.push('缺少样本名');
    if (!row.target) reasons.push('缺少基因名');
    if (!Number.isFinite(row.cq)) reasons.push('Cq 非数值');
    if (Number.isFinite(row.cq) && Number.isFinite(settings.minCq) && row.cq < settings.minCq) {
      reasons.push(`Cq < 下限 ${settings.minCq}`);
    }
    if (Number.isFinite(row.cq) && Number.isFinite(settings.maxCq) && row.cq > settings.maxCq) {
      reasons.push(`Cq > 上限 ${settings.maxCq}`);
    }
    if (reasons.length) flags[row.id] = reasons;
    if (!row.excluded && row.sample && row.target && Number.isFinite(row.cq)) {
      const key = `${row.sample}||${row.target}`;
      const arr = groups.get(key);
      if (arr) arr.push(row);
      else groups.set(key, [row]);
    }
  }

  for (const arr of groups.values()) {
    if (arr.length < 3) continue;
    const values = arr.map((r) => r.cq);
    const m = values.reduce((s, x) => s + x, 0) / values.length;
    const s = sd(values);
    for (const row of arr) {
      const dev = Math.abs(row.cq - m);
      const reasons = flags[row.id] ?? [];
      if (Number.isFinite(settings.absDev) && settings.absDev > 0 && dev > settings.absDev) {
        reasons.push(`复孔偏差 ${dev.toFixed(2)}`);
      }
      if (Number.isFinite(settings.zScore) && settings.zScore > 0 && s > 0 && dev / s > settings.zScore) {
        reasons.push(`离群 z=${(dev / s).toFixed(1)}`);
      }
      if (reasons.length) flags[row.id] = reasons;
    }
  }

  return flags;
}
