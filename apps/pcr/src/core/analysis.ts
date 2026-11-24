import type {
  AnalysisConfig,
  AnalysisOutput,
  ColumnMapping,
  NtcReportEntry,
  QcFlags,
  SampleTargetResult,
} from './types';
import { mean, sd, dunnettAdjustedP, oneWayAnova, significanceStars, welchTTest } from './stats';
// isStandardRow 定义于本文件（standard.ts 反向引用），避免循环依赖

export interface AnalysisRow {
  id: number;
  plate: string;
  well: string;
  sample: string;
  group: string;
  pairId: string;
  target: string;
  task: string;
  cq: number;
  quantity: number;
  excluded: boolean;
}

/** 从原始数据行 + 列映射抽取规范行。 */
export function extractRows(rows: string[][], mapping: ColumnMapping): AnalysisRow[] {
  const out: AnalysisRow[] = [];
  rows.forEach((row, idx) => {
    const id = idx + 1;
    out.push({
      id,
      plate: mapping.plate >= 0 ? (row[mapping.plate] ?? '').trim() : '',
      well: mapping.well >= 0 ? (row[mapping.well] ?? '').trim() : '',
      sample: mapping.sample >= 0 ? (row[mapping.sample] ?? '').trim() : '',
      group: mapping.group >= 0 ? (row[mapping.group] ?? '').trim() : '',
      pairId: mapping.pairId >= 0 ? (row[mapping.pairId] ?? '').trim() : '',
      target: mapping.target >= 0 ? (row[mapping.target] ?? '').trim() : '',
      task: mapping.task >= 0 ? (row[mapping.task] ?? '').trim() : '',
      cq: mapping.cq >= 0 ? Number.parseFloat((row[mapping.cq] ?? '').replace(',', '.')) : NaN,
      quantity: mapping.quantity >= 0 ? Number.parseFloat((row[mapping.quantity] ?? '').replace(',', '.')) : NaN,
      excluded: false,
    });
  });
  return out;
}

/** NTC 判定：Task 列为 NTC，或样本名是 NTC / NTC-1 / NTC1 等惯例命名。 */
export function isNtcRow(row: Pick<AnalysisRow, 'sample' | 'task'>): boolean {
  const task = row.task.toLowerCase().replace(/[\s_-]+/g, '');
  if (task === 'ntc') return true;
  const sample = row.sample.toLowerCase().replace(/[\s_-]+/g, ' ');
  return /^ntc(\b|$|\s|[0-9])/.test(sample.trim());
}

/** 标准品判定：Task 列 STANDARD，或样本名 Std/Standard/标准 + 分隔符惯例。 */
export function isStandardRow(row: Pick<AnalysisRow, 'sample' | 'task'>): boolean {
  const task = row.task.toLowerCase().replace(/[\s_-]+/g, '');
  if (task === 'standard' || task === 'std') return true;
  const sample = row.sample.trim();
  return /^(std|standard)([\s_\-]|\b|$)/i.test(sample) || /^标准([品曲样]?)([\s_\-]|\d|$)/.test(sample);
}

/** NTC 扩增 Cq 低于该值视为疑似污染；高于等于该值为晚期无害扩增。 */
export const NTC_CONTAMINATION_CQ = 35;

/**
 * ΔΔCt（Livak 2^-ΔΔCt）引擎。
 * 1. 同样本同基因复孔聚均值；
 * 2. 多内参基因池化（每样本取可用内参 Cq 均值）；
 * 3. 按每个生物学重复计算 ΔCt（个体值保留，用于统计）；
 * 4. ΔΔCt = 个体 ΔCt − 对照组 ΔCt 均值；FC = 2^-ΔΔCt；
 * 5. 统计：2 组 → 与对照 Welch t；>2 组 → 单因素 ANOVA（全体）。均在个体 ΔCt 上进行。
 */
export function analyzeDeltaDeltaCt(rows: AnalysisRow[], config: AnalysisConfig): AnalysisOutput {
  const warnings: string[] = [];
  const nonExcluded = rows.filter((r) => !r.excluded);
  const ntcRows = nonExcluded.filter(isNtcRow);
  const effective = nonExcluded.filter((r) => !isNtcRow(r) && !isStandardRow(r));

  // 1. 复孔聚合
  const agg = new Map<string, AnalysisRow[]>();
  for (const r of effective) {
    if (!r.sample || !r.target || !Number.isFinite(r.cq)) continue;
    const key = `${r.sample}||${r.target}`;
    const arr = agg.get(key);
    if (arr) arr.push(r);
    else agg.set(key, [r]);
  }

  const samples = [...new Set(effective.map((r) => r.sample).filter(Boolean))].sort();
  const genes = [...new Set(effective.map((r) => r.target).filter(Boolean))].sort();
  const refGenes = config.refGenes.filter((g) => genes.includes(g));
  const targetGenes = genes.filter((g) => !refGenes.includes(g));
  const controls = config.controlSamples.filter((s) => samples.includes(s));

  if (refGenes.length === 0) warnings.push('未找到可用的内参基因（请确认基因名）。');
  if (controls.length === 0) warnings.push('未找到对照组样本（请确认对照组设置）。');
  const missingRef = config.refGenes.filter((g) => !genes.includes(g));
  if (missingRef.length) warnings.push(`内参基因未在数据中出现：${missingRef.join('、')}`);
  const missingCtrl = config.controlSamples.filter((s) => !samples.includes(s));
  if (missingCtrl.length) warnings.push(`对照组样本未在数据中出现：${missingCtrl.join('、')}`);

  // NTC 污染检查：覆盖全部基因（内参被污染同样会使 ΔCt 失效），逐基因报告
  const ntcReport: NtcReportEntry[] = [];
  const genesForNtc = [...new Set([...targetGenes, ...refGenes])];
  for (const g of genesForNtc) {
    const wells = ntcRows.filter((r) => r.target === g);
    if (wells.length === 0) continue;
    const cqs = wells.map((r) => r.cq).filter((v) => Number.isFinite(v));
    const minCq = cqs.length ? Math.min(...cqs) : null;
    let verdict: NtcReportEntry['verdict'] = 'pass';
    let message = `NTC 无扩增（${wells.length} 孔），无污染迹象`;
    if (minCq !== null) {
      if (minCq < NTC_CONTAMINATION_CQ) {
        verdict = 'contaminated';
        message = `NTC 提前扩增（最低 Cq ${minCq.toFixed(1)}）——疑似试剂或环境污染，该基因结果不可信`;
      } else {
        verdict = 'late';
        message = `NTC 晚期扩增（最低 Cq ${minCq.toFixed(1)}）——通常无害，建议复孔确认`;
      }
    }
    ntcReport.push({
      target: g,
      wells: wells.map((r) => r.well).filter(Boolean),
      amplified: cqs.length,
      minCq,
      verdict,
      message,
    });
    if (verdict !== 'pass') warnings.push(`${g}：${message}`);
  }
  ntcReport.sort((a, b) => {
    const rank = { contaminated: 0, late: 1, pass: 2 } as const;
    if (rank[a.verdict] !== rank[b.verdict]) return rank[a.verdict] - rank[b.verdict];
    return a.target.localeCompare(b.target);
  });

  interface AggEntry {
    sample: string;
    group: string;
    target: string;
    values: number[];
    wells: string[];
    meanCq: number;
    sdCq: number;
  }
  const entries = new Map<string, AggEntry>();
  for (const [key, rs] of agg) {
    const values = rs.map((r) => r.cq);
    entries.set(key, {
      sample: rs[0].sample,
      group: rs[0].group,
      target: rs[0].target,
      values,
      wells: rs.map((r) => r.well).filter(Boolean),
      meanCq: mean(values),
      sdCq: sd(values),
    });
  }

  const effPct = (gene: string): number => {
    const value = config.efficiencies?.[gene];
    return Number.isFinite(value) && value != null ? value : 100;
  };
  // 2. 每样本内参池化。Cq 均值用于既有 ΔCt；效率校正先逐基因转换再几何池化。
  // Reference normalization is mean(Cq_j * log2(E_j)), not mean(Cq) * log2(mean(E)).
  const refCqBySample = new Map<string, number>();
  const referenceLog2BySample = new Map<string, number>();
  for (const s of samples) {
    const refs: number[] = [];
    const referenceLog2: number[] = [];
    for (const g of refGenes) {
      const e = entries.get(`${s}||${g}`);
      if (e) {
        refs.push(e.meanCq);
        referenceLog2.push(e.meanCq * Math.log2(1 + effPct(g) / 100));
      }
    }
    if (refs.length) {
      refCqBySample.set(s, mean(refs));
      referenceLog2BySample.set(s, mean(referenceLog2));
    }
  }

  // 内参在部分样本未检出的显式告警（否则会静默产出 0 条结果）
  const samplesWithTarget = samples.filter((s) => targetGenes.some((g) => entries.has(`${s}||${g}`)));
  const missingRefSamples = samplesWithTarget.filter((s) => !refCqBySample.has(s));
  if (missingRefSamples.length > 0 && refGenes.length > 0) {
    warnings.push(
      `内参基因（${refGenes.join('、')}）在以下样本未检出：${missingRefSamples.join('、')}——相关 ΔCt 无法计算，请更换或补充内参基因`,
    );
  }
  const ctrlAllMissing =
    controls.length > 0 && refGenes.length > 0 && controls.every((s) => !refCqBySample.has(s));
  if (ctrlAllMissing) {
    warnings.push(
      `对照组样本（${controls.join('、')}）的内参基因均未检出——无法计算 ΔΔCt，请改用其他内参基因`,
    );
  }

  // 3. 个体 ΔCt
  interface DeltaEntry {
    sample: string;
    group: string;
    target: string;
    values: number[];
    wells: string[];
    meanCq: number;
    sdCq: number;
    refCq: number;
    deltaCtValues: number[];
    deltaCt: number;
    sdDelta: number;
  }
  const deltas = new Map<string, DeltaEntry>();
  for (const g of targetGenes) {
    for (const s of samples) {
      const e = entries.get(`${s}||${g}`);
      const refCq = refCqBySample.get(s);
      if (!e || refCq === undefined) continue;
      const deltaCtValues = e.values.map((v) => v - refCq);
      deltas.set(`${s}||${g}`, {
        sample: s,
        group: e.group,
        target: g,
        values: e.values,
        wells: e.wells,
        meanCq: e.meanCq,
        sdCq: e.sdCq,
        refCq,
        deltaCtValues,
        deltaCt: mean(deltaCtValues),
        sdDelta: sd(deltaCtValues),
      });
    }
  }

  // 4. 对照组 ΔCt 均值（按基因）
  const ctrlMeanByGene = new Map<string, number>();
  for (const g of targetGenes) {
    const vals: number[] = [];
    for (const s of controls) {
      const d = deltas.get(`${s}||${g}`);
      if (d) vals.push(...d.deltaCtValues);
    }
    if (vals.length) ctrlMeanByGene.set(g, mean(vals));
  }

  // 5. ΔΔCt / FC / 统计
  const results: SampleTargetResult[] = [];
  let anyEffMode = false;
  for (const g of targetGenes) {
    const ctrlMean = ctrlMeanByGene.get(g);
    if (ctrlMean === undefined) continue;
    const geneEntries = [...deltas.values()].filter((d) => d.target === g);
    const ctrlVals: number[] = [];
    for (const d of geneEntries) {
      if (controls.includes(d.sample)) ctrlVals.push(...d.deltaCtValues);
    }

    // Generalized Pfaffl: target relative quantity / geometric mean of reference relative quantities.
    // All participating efficiencies = 100% (E=2) retains the existing Livak path.
    const eTarget = 1 + effPct(g) / 100;
    const effActive = Math.abs(eTarget - 2) > 1e-9 || refGenes.some(ref => Math.abs(effPct(ref) - 100) > 1e-7);
    let ctTCtrl: number | null = null;
    {
      const ctrlRaw: number[] = [];
      for (const d of geneEntries) if (controls.includes(d.sample)) ctrlRaw.push(...d.values);
      if (ctrlRaw.length) ctTCtrl = mean(ctrlRaw);
    }
    const ctrlReferenceLog2 = controls
      .map((s) => referenceLog2BySample.get(s))
      .filter((v): v is number => v != null);
    const controlReferenceLog2 = ctrlReferenceLog2.length ? mean(ctrlReferenceLog2) : null;
    const geneEffMode = effActive && ctTCtrl != null && controlReferenceLog2 != null;
    if (geneEffMode) anyEffMode = true;

    // 多组：ANOVA 总体检验 + Dunnett vs 对照的逐组校正 p
    const useAnova = geneEntries.length > 2 && samples.length > 2 && ctrlVals.length >= 2;
    let anova: ReturnType<typeof oneWayAnova> | null = null;
    const pAdjBySample = new Map<string, number>();
    if (useAnova) {
      anova = oneWayAnova(groupValuesBySample(geneEntries, controls));
      if (
        Number.isFinite(anova.df2) &&
        anova.df2 > 0 &&
        Number.isFinite(anova.msWithin) &&
        anova.msWithin > 0
      ) {
        const ctrlN = ctrlVals.length;
        const comparisons: { b: number; tAbs: number }[] = [];
        const compSamples: string[] = [];
        for (const d of geneEntries) {
          if (controls.includes(d.sample)) continue;
          if (d.deltaCtValues.length < 2) continue;
          comparisons.push({
            b: Math.sqrt(d.deltaCtValues.length / ctrlN),
            tAbs: Math.abs(
              (mean(d.deltaCtValues) - ctrlMean) /
                (Math.sqrt(anova.msWithin) *
                  Math.sqrt(1 / d.deltaCtValues.length + 1 / ctrlN)),
            ),
          });
          compSamples.push(d.sample);
        }
        if (comparisons.length >= 1) {
          const adj = dunnettAdjustedP(comparisons, anova.df2);
          compSamples.forEach((s, i) => pAdjBySample.set(s, adj[i]));
        }
      }
    }

    for (const d of geneEntries) {
      const isControl = controls.includes(d.sample);
      const fcValues = geneEffMode
        ? d.values.map((v) => Math.pow(2, ((ctTCtrl as number) - v) * Math.log2(eTarget)
          + (referenceLog2BySample.get(d.sample) as number) - (controlReferenceLog2 as number)))
        : d.deltaCtValues.map((v) => Math.pow(2, -(v - ctrlMean)));
      const fcMean = mean(fcValues);
      const fcSd = sd(fcValues);
      let pValue: number | null = null;
      let pAdjusted: number | null = null;
      let statMethod = '';
      if (!isControl && ctrlVals.length >= 2) {
        if (useAnova && anova && Number.isFinite(anova.p)) {
          pValue = anova.p;
          pAdjusted = pAdjBySample.get(d.sample) ?? null;
          statMethod = `单因素 ANOVA（F=${anova.f.toFixed(2)}, df=${anova.df1}/${anova.df2}）${
            pAdjusted != null ? '；Dunnett vs 对照' : ''
          }`;
        }
        if (pValue == null) {
          const t = welchTTest(d.deltaCtValues, ctrlVals);
          pValue = Number.isFinite(t.p) ? t.p : null;
          statMethod = `Welch t（t=${t.t.toFixed(2)}, df=${Number.isFinite(t.df) ? t.df.toFixed(1) : '-'}）`;
        }
        if (geneEffMode) statMethod += '；FC 经 Pfaffl 效率校正';
      }
      const deltaCt = mean(d.deltaCtValues);
      const ddCt = deltaCt - ctrlMean;
      results.push({
        sample: d.sample,
        group: d.group,
        target: g,
        isControl,
        excluded: false,
        n: d.values.length,
        values: d.values,
        wells: d.wells,
        meanCq: d.meanCq,
        sdCq: d.sdCq,
        refCq: d.refCq,
        deltaCt,
        deltaCtValues: d.deltaCtValues,
        ddCt,
        foldChange: geneEffMode ? fcMean : Math.pow(2, -ddCt),
        fcValues,
        fcMean,
        fcSd,
        pValue,
        pAdjusted,
        significance: isControl ? '' : significanceStars(pAdjusted ?? pValue),
        statMethod,
      });
    }
  }

  results.sort((a, b) => {
    if (a.target !== b.target) return a.target.localeCompare(b.target);
    if (a.isControl !== b.isControl) return a.isControl ? -1 : 1;
    return a.sample.localeCompare(b.sample);
  });

  return {
    results,
    refGenesUsed: refGenes,
    controlSamples: controls,
    warnings,
    ntcReport,
    effMode: anyEffMode,
    efficiencies: { ...(config.efficiencies ?? {}) },
  };
}

function groupValuesBySample(entries: { sample: string; deltaCtValues: number[] }[], controls: string[]): number[][] {
  const bySample = new Map<string, number[]>();
  for (const d of entries) {
    if (controls.includes(d.sample)) continue;
    const arr = bySample.get(d.sample);
    if (arr) arr.push(...d.deltaCtValues);
    else bySample.set(d.sample, [...d.deltaCtValues]);
  }
  return [...bySample.values()].filter((g) => g.length >= 2);
}

/** QC 标记是否命中某行。 */
export function isFlagged(flags: QcFlags | undefined, id: number): boolean {
  return !!flags && (flags[id]?.length ?? 0) > 0;
}

const COMMON_REF_GENES = [
  'gapdh', 'actb', 'actin', 'b2m', 'hprt1', 'hprt', 'rplp0', 'tbp',
  'sdha', 'ywhaz', 'ubc', '18s', 'rpl13a', 'ppia', 'canx',
];

/** 按名字猜测常见内参基因（GAPDH/ACTB/18S 等），供配置步预勾选。 */
export function guessRefGenes(genes: string[]): string[] {
  return genes.filter((g) => {
    const n = g.toLowerCase().replace(/[\s_-]/g, '');
    return COMMON_REF_GENES.some((r) => n === r.replace(/[\s_-]/g, ''));
  });
}
