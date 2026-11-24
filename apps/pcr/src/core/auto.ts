// 一键分析 API：喂入仪器导出文件，自动识别表头/列/实验配置，
// 跑完 QC + NTC + ΔΔCt + 统计，产出结构化的"问题清单 + 优化建议 + 质量分"。
// 同一套逻辑同时驱动界面上的"一键智能分析"按钮与本机 REST 服务。

import { analyzeDeltaDeltaCt, extractRows, guessRefGenes, isNtcRow, type AnalysisRow } from './analysis';
import { computeQcFlags } from './qc';
import { readInputFile, sheetToRawMatrix } from './parse';
import { sniff } from './sniff';
import { fitAllStandardCurves } from './standard';
import { summarizeMeltByGene, type RdmlMeltCurve } from './melt';
import { sd } from './stats';
import { isStandardRow } from './analysis';
import { mappingComplete, type AnalysisConfig, type AnalysisOutput, type ColumnMapping, type QcFlags } from './types';

export type IssueSeverity = 'error' | 'warning' | 'info';

const SEVERITY_PENALTY: Record<IssueSeverity, number> = { error: 25, warning: 8, info: 2 };

export interface Issue {
  code: string;
  severity: IssueSeverity;
  message: string;
  /** 涉及的基因/样本/孔位等定位信息 */
  target?: string;
}

export interface Advice {
  code: string;
  message: string;
}

export interface ExperimentGuess {
  controlSamples: string[];
  refGenes: string[];
  /** 推断依据（向用户解释自动配置从哪来） */
  basis: string;
}

export interface QualityReport {
  /** 0–100，扣分制 */
  score: number;
  issues: Issue[];
  advice: Advice[];
  summary: string;
}

export interface AutoAnalysisResult {
  fileName: string;
  sheetName: string;
  headerRow: number;
  mapping: ColumnMapping;
  config: AnalysisConfig;
  guess: ExperimentGuess;
  rows: AnalysisRow[];
  flags: QcFlags;
  output: AnalysisOutput;
  report: QualityReport;
  /** 熔解曲线按基因汇总（RDML 原始曲线可用时） */
  melt: ReturnType<typeof summarizeMeltByGene>;
}

const CONTROL_KEYWORDS = [
  'control', 'ctrl', 'con', 'sham', 'wt', 'vehicle', 'normal', 'blank', 'ck', 'mock', 'untreated',
  '对照', '阴性', '空白', '正常', '假手术',
];

function normalizeName(v: string): string {
  return v.toLowerCase().trim().replace(/[\s_\-]+/g, ' ').replace(/\s*\d+$/, '').trim();
}

function looksControl(name: string): boolean {
  const n = normalizeName(name);
  if (!n) return false;
  return CONTROL_KEYWORDS.some((k) => {
    // ASCII 关键词要求完整词（防 "con" 误吞 "condition"）；中文允许直接前缀（"对照组" 命中 "对照"）
    if (/[a-z]/.test(k)) return n === k || n.startsWith(k + ' ');
    return n.startsWith(k);
  });
}

/** 从样本名 / 组别列推断对照组（与用户在界面上可改的配置同一形状）。 */
export function inferExperiment(
  samples: string[],
  genes: string[],
  groupOf?: (sample: string) => string,
): ExperimentGuess {
  // 优先用组别列：整组命中关键词才采纳
  if (groupOf) {
    const byGroup = new Map<string, string[]>();
    for (const s of samples) {
      const g = (groupOf(s) || '').trim();
      if (!g) continue;
      byGroup.set(g, [...(byGroup.get(g) ?? []), s]);
    }
    for (const [g, members] of byGroup) {
      if (looksControl(g)) {
        return {
          controlSamples: members,
          refGenes: guessRefGenes(genes),
          basis: `组别「${g}」命中对照关键词，共 ${members.length} 个样本`,
        };
      }
    }
  }
  const byName = samples.filter(looksControl);
  const basis = byName.length
    ? `样本名命中对照关键词（如 ${byName[0]}），共 ${byName.length} 个样本`
    : '未推断出对照组，请手动指定';
  return { controlSamples: byName, refGenes: guessRefGenes(genes), basis };
}


export interface ReportInput {
  rows: AnalysisRow[];
  flags: QcFlags;
  output: AnalysisOutput;
  guess: ExperimentGuess;
  mappingComplete: boolean;
  headerRow: number;
}

/** 规则引擎：从分析产物中找出问题并给出可执行的优化建议（完全离线、确定性）。 */
export function buildQualityReport(input: ReportInput): QualityReport {
  const issues: Issue[] = [];
  const advice: Advice[] = [];
  const { rows, flags, output, guess } = input;

  const nonNtc = rows.filter((r) => !isNtcRow(r));
  const finiteCq = nonNtc.filter((r) => Number.isFinite(r.cq));

  // 映射完整性
  if (!input.mappingComplete) {
    issues.push({ code: 'MAPPING_INCOMPLETE', severity: 'error', message: '必需列（样本/基因/Cq）未全部识别，分析不可信' });
    advice.push({ code: 'FIX_MAPPING', message: '回到第 2 步手动指定列映射后再分析' });
  }
  if (input.headerRow > 10) {
    issues.push({ code: 'DEEP_HEADER', severity: 'info', message: `表头位于第 ${input.headerRow + 1} 行，文件含大段元数据，已自动跳过` });
  }

  // 内参
  if (output.refGenesUsed.length === 0) {
    issues.push({ code: 'NO_REF_GENE', severity: 'error', message: '未识别到常见内参基因（GAPDH/ACTB 等），ΔCt 无法计算' });
    advice.push({ code: 'SET_REF', message: '在实验配置中手动勾选内参基因；建议选用经过验证的稳定内参' });
  } else {
    // 内参稳定性：池化 refCq 在样本间的波动
    const bySample = new Map(output.results.filter((r) => !r.isControl && Number.isFinite(r.refCq)).map((r) => [r.sample, r.refCq!]));
    const refCqs = [...bySample.values()];
    if (refCqs.length >= 3) {
      const s = sd(refCqs);
      if (s > 0.7) {
        issues.push({ code: 'REF_UNSTABLE', severity: 'warning', message: `内参 Cq 在样本间波动较大（SD=${s.toFixed(2)}）` });
        advice.push({ code: 'CHECK_REF', message: '检查内参在不同处理下是否稳定表达，或改用更稳定的内参组合' });
      }
    }
  }

  // 对照组
  if (guess.controlSamples.length === 0 || output.controlSamples.length === 0) {
    issues.push({ code: 'NO_CONTROL', severity: 'error', message: '未确定对照组样本，ΔΔCt 无基准' });
    advice.push({ code: 'SET_CONTROL', message: '在实验配置中指定对照组（如 Control/Sham/WT）' });
  } else {
    const ctrlN = output.results.filter((r) => r.isControl).reduce((s, r) => s + r.n, 0);
    if (ctrlN > 0 && ctrlN < 3) {
      issues.push({ code: 'CONTROL_SMALL', severity: 'warning', target: output.controlSamples.join('、'), message: `对照组总复孔数仅 ${ctrlN}，统计效力不足` });
      advice.push({ code: 'MORE_REPLICATES', message: '对照组建议 ≥3 个生物学重复（每重复 ≥2 复孔）' });
    }
  }

  // 复孔与样本量
  const treatmentRows = output.results.filter((r) => !r.isControl);
  const singleRep = treatmentRows.filter((r) => r.n < 2);
  if (singleRep.length > 0) {
    issues.push({ code: 'NO_REPLICATE', severity: 'warning', target: singleRep.slice(0, 3).map((r) => r.sample).join('、'), message: `${singleRep.length} 个"样本×基因"组合只有 1 孔，无复孔可用` });
    advice.push({ code: 'TECH_REPLICATE', message: '每个样本×基因至少 2–3 个技术复孔，便于离群判定' });
  }
  const highSd = treatmentRows.filter((r) => Number.isFinite(r.sdCq) && r.sdCq > 0.7);
  if (highSd.length > 0) {
    issues.push({ code: 'HIGH_REPLICATE_SD', severity: 'warning', target: highSd.slice(0, 3).map((r) => `${r.sample}/${r.target}(SD ${r.sdCq.toFixed(2)})`).join('、'), message: `${highSd.length} 个组合复孔 SD > 0.7` });
    advice.push({ code: 'PIPETTING', message: '复孔波动大通常源于移液/混匀：检查加样一致性，必要时加大模板量重做' });
  }
  if (treatmentRows.length > 0 && treatmentRows.every((r) => r.n < 3)) {
    advice.push({ code: 'BIO_REPLICATE', message: '每处理组建议 ≥3 个生物学重复，否则组间比较说服力有限' });
  }

  // NTC
  for (const e of output.ntcReport) {
    if (e.verdict === 'contaminated') {
      issues.push({ code: 'NTC_CONTAMINATED', severity: 'error', target: e.target, message: e.message });
      advice.push({ code: 'NTC_TROUBLESHOOT', message: `${e.target}：更换试剂/用新水做 NTC、清洁工作台与移液器，隔离前扩增区重做该基因` });
    } else if (e.verdict === 'late') {
      issues.push({ code: 'NTC_LATE', severity: 'info', target: e.target, message: e.message });
    }
  }
  if (rows.some(isNtcRow) && output.ntcReport.length === 0) {
    issues.push({ code: 'NTC_NO_DATA', severity: 'info', message: '数据含 NTC 孔，但其基因没有对应的样本数据，未纳入判定' });
  }

  // Cq 范围
  const outOfRange = finiteCq.filter((r) => r.cq < 15 || r.cq > 35);
  if (outOfRange.length > 0) {
    issues.push({ code: 'CQ_OUT_OF_RANGE', severity: 'warning', target: outOfRange.slice(0, 3).map((r) => r.well || `#${r.id}`).join('、'), message: `${outOfRange.length} 行 Cq 超出 15–35 常规可信区间` });
    advice.push({ code: 'CHECK_CQ_RANGE', message: 'Cq > 35 的孔接近检测极限，建议结合扩增曲线确认后再决定取舍' });
  }

  // QC 标记比例
  const flagCount = Object.keys(flags).length;
  if (nonNtc.length > 0 && flagCount / nonNtc.length > 0.1) {
    issues.push({ code: 'MANY_FLAGGED', severity: 'warning', message: `${Math.round((flagCount / nonNtc.length) * 100)}% 的数据行被 QC 标记` });
    advice.push({ code: 'REVIEW_FLAGS', message: '大量标记说明批次质量欠佳：复查操作记录，考虑整板重做' });
  }

  if (output.results.length > 0 && !output.effMode) {
    advice.push({ code: 'PFAFFL_SUGGEST', message: '若已有各基因的标准曲线，在实验配置里填入扩增效率即可启用 Pfaffl 校正（目标与内参效率差异大时 Livak 会有偏差）' });
  }

  // 统计边界
  const borderline = output.results.filter((r) => r.pAdjusted != null && r.pAdjusted >= 0.05 && r.pAdjusted < 0.15);
  if (borderline.length > 0) {
    issues.push({ code: 'P_BORDERLINE', severity: 'info', target: borderline.map((r) => `${r.sample}/${r.target}`).slice(0, 3).join('、'), message: `${borderline.length} 个比较的校正 p 落在 0.05–0.15 边界区` });
    advice.push({ code: 'MORE_POWER', message: '边界结论对样本量敏感：增加生物学重复可能改变结论' });
  }
  const extreme = output.results.filter((r) => r.foldChange != null && (r.foldChange > 16 || r.foldChange < 0.0625));
  if (extreme.length > 0) {
    issues.push({ code: 'EXTREME_FC', severity: 'info', target: extreme.slice(0, 3).map((r) => `${r.sample}/${r.target}`).join('、'), message: `${extreme.length} 个组合 Fold Change 超出 1/16–16 倍` });
    advice.push({ code: 'VERIFY_EXTREME', message: '极端倍数变化建议用独立样本或更低 Ct 起始量验证，排除天花板/地板效应' });
  }

  // 评分
  const score = Math.max(
    0,
    Math.min(100, 100 - issues.reduce((s, i) => s + SEVERITY_PENALTY[i.severity], 0)),
  );
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const summary =
    errors > 0
      ? `发现 ${errors} 个严重问题、${warnings} 个警告，建议处理后重新分析`
      : warnings > 0
        ? `无严重问题，${warnings} 个警告值得关注`
        : issues.length > 0
          ? '整体良好，仅有少量提示'
          : '未发现明显问题，实验与分析质量良好';

  return { score, issues, advice, summary };
}

/** 一键分析：单工作表矩阵 → 全流程结果。 */
export function analyzeAuto(
  matrix: string[][],
  opts: { fileName?: string; sheetName?: string; presetEfficiencies?: Record<string, number>; meltCurves?: RdmlMeltCurve[] } = {},
): AutoAnalysisResult {
  const s = sniff(matrix);
  const rows = extractRows(matrix.slice(s.headerRow + 1), s.mapping);
  const samples = [...new Set(rows.filter((r) => !isNtcRow(r) && !isStandardRow(r)).map((r) => r.sample).filter(Boolean))].sort();
  const genes = [...new Set(rows.map((r) => r.target).filter(Boolean))].sort();
  const groupMap = new Map(rows.filter((r) => !isNtcRow(r) && !isStandardRow(r)).map((r) => [r.sample, r.group] as const));
  const guess = inferExperiment(samples, genes, s.mapping.group >= 0 ? (sample) => groupMap.get(sample) ?? '' : undefined);

  // 标准曲线：R² ≥ 0.98 的拟合自动应用为该基因效率
  const stdCurves = fitAllStandardCurves(rows, { minR2: 0.98 });
  const curveEfficiencies: Record<string, number> = {};
  for (const [gene, curve] of stdCurves) {
    curveEfficiencies[gene] = Math.round(curve.effPct * 10) / 10;
  }

  // 预置效率（如 RDML 靶标声明）先入，标准曲线实测拟合优先覆盖
  const mergedEfficiencies: Record<string, number> = { ...(opts.presetEfficiencies ?? {}) };
  for (const [gene, v] of Object.entries(curveEfficiencies)) mergedEfficiencies[gene] = v;

  const config: AnalysisConfig = {
    controlSamples: guess.controlSamples,
    refGenes: guess.refGenes,
    qc: { minCq: NaN, maxCq: NaN, absDev: NaN, zScore: NaN },
    efficiencies: Object.keys(mergedEfficiencies).length ? mergedEfficiencies : undefined,
  };
  const flags = computeQcFlags(
    rows.filter((r) => !isNtcRow(r)).map((r) => ({ id: r.id, sample: r.sample, target: r.target, cq: r.cq, excluded: r.excluded })),
    config.qc,
  );
  const output = analyzeDeltaDeltaCt(rows, config);
  const report = buildQualityReport({
    rows,
    flags,
    output,
    guess,
    mappingComplete: mappingComplete(s.mapping),
    headerRow: s.headerRow,
  });

  // 标准曲线信息进报告
  for (const [gene, curve] of stdCurves) {
    report.issues.unshift({
      code: 'STD_CURVE_APPLIED',
      severity: Math.abs(curve.effPct - 100) > 10 ? 'warning' : 'info',
      target: gene,
      message: `标准曲线已应用：n=${curve.n}，斜率 ${curve.slope.toFixed(3)}，R²=${curve.r2.toFixed(4)}，效率 ${curve.effPct.toFixed(1)}%${Math.abs(curve.effPct - 100) > 10 ? '（超出 90–110% 常规区间，建议检查引物）' : ''}`,
    });
  }

  // 熔解曲线 QC：多峰 = 非特异扩增 / 引物二聚体
  const melt = summarizeMeltByGene(opts.meltCurves ?? []);
  for (const m of melt) {
    if (m.multi.length > 0) {
      report.issues.push({
        code: 'MELT_MULTI_PEAK',
        severity: 'warning',
        target: m.gene,
        message: `熔解曲线多峰（${m.multi.length}/${m.checked} 孔，Tm ${m.multi
          .slice(0, 3)
          .map((w) => `${w.well}@${w.tm}°C`)
          .join('、')}）——可能非特异扩增或引物二聚体`,
      });
    }
  }
  report.score = Math.max(
    0,
    Math.min(100, 100 - report.issues.reduce((sum, i) => sum + SEVERITY_PENALTY[i.severity], 0)),
  );

  return {
    fileName: opts.fileName ?? '',
    sheetName: opts.sheetName ?? '',
    headerRow: s.headerRow,
    mapping: s.mapping,
    config,
    guess,
    rows,
    flags,
    output,
    report,
    melt,
  };
}

export interface AnalyzeFileOptions {
  /** 多工作表时的选择策略，默认取数据行最多的表 */
  sheet?: 'largest' | 'first';
}

/** 一键分析：File 对象 → 全流程结果（浏览器与 Node 通用）。支持 RDML 标准格式。 */
export async function analyzeFileAuto(file: File, opts: AnalyzeFileOptions = {}): Promise<AutoAnalysisResult & { matrix: string[][] }> {
  const parsed = await readInputFile(file);
  if (parsed.kind === 'rdml') {
    const result = analyzeAuto(parsed.matrix, {
      fileName: file.name,
      sheetName: 'RDML',
      presetEfficiencies: parsed.targetEfficiencies,
      meltCurves: parsed.meltCurves,
    });
    if (Object.keys(parsed.targetEfficiencies).length) {
      result.report.issues.unshift({
        code: 'RDML_EFFICIENCY_APPLIED',
        severity: 'info',
        message: `RDML 靶标声明效率已应用：${Object.entries(parsed.targetEfficiencies)
          .map(([g, v]) => `${g} ${v.toFixed(1)}%`)
          .join('、')}`,
      });
    }
    return { ...result, matrix: parsed.matrix };
  }
  const wbFile = parsed;
  const summaries = wbFile.sheetNames
    .map((name) => ({ name, matrix: sheetToRawMatrix(wbFile.wb, name) }))
    .filter((s) => s.matrix.length > 0);
  if (summaries.length === 0) throw new Error('文件里没有可读的数据行');
  const chosen =
    opts.sheet === 'first'
      ? summaries[0]
      : summaries.reduce((a, b) => (b.matrix.length > a.matrix.length ? b : a));
  const result = analyzeAuto(chosen.matrix, { fileName: file.name, sheetName: chosen.name });
  return {
    ...result,
    matrix: chosen.matrix,
    ...(summaries.length > 1
      ? {
          report: {
            ...result.report,
            issues: [
              { code: 'SHEET_AUTO_PICKED', severity: 'info' as const, message: `文件含 ${summaries.length} 个工作表，已自动选择数据最多的「${chosen.name}」` },
              ...result.report.issues,
            ],
          },
        }
      : {}),
  };
}
