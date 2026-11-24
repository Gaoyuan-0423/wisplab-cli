import type {
  AnalysisConfig,
  AnalysisDesignIssue,
  DesignStatus,
  ExperimentalUnitAssignment,
  GroupTargetResult,
  SampleIdentity,
  AnalysisOutput,
  ColumnMapping,
  NtcReportEntry,
  QcFlags,
  SampleTargetResult,
} from './types';
import { mean, sd, dunnettAdjustedP, oneWayAnova, significanceStars, welchTTest } from './stats';
import { parseCq, parseQuantity, resolveNumericColumns } from './number';
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
  const { quantityDecimal } = resolveNumericColumns(rows, mapping);
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
      cq: mapping.cq >= 0 ? parseCq(row[mapping.cq] ?? '') : NaN,
      quantity: mapping.quantity >= 0 ? parseQuantity(row[mapping.quantity] ?? '', quantityDecimal) : NaN,
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

/** JSON tuple keys preserve plate/sample and unit/group identity without delimiter collisions. */
function sampleKey(sample: SampleIdentity): string {
  return JSON.stringify([sample.plate, sample.sample]);
}

function uniqueSampleIds(rows: SampleIdentity[]): SampleIdentity[] {
  return [...new Map(rows.map((row) => [sampleKey(row), { plate: row.plate, sample: row.sample }])).values()];
}

function resolveDesign(rows: AnalysisRow[], config: AnalysisConfig): {
  status: DesignStatus;
  issues: AnalysisDesignIssue[];
  assignments: Map<string, ExperimentalUnitAssignment>;
} {
  const design = config.experimentalDesign;
  const assignments = new Map<string, ExperimentalUnitAssignment>();
  const issues: AnalysisDesignIssue[] = [];
  if (!design || design.confirmed !== true) {
    if (design?.kind === 'paired' || design?.kind === 'repeated') {
      return { status: 'unsupported', issues: [{ code: 'DESIGN_UNSUPPORTED', message: '当前推断仅支持独立组设计；配对或重复测量保留描述结果，不产生独立组 p 值。' }], assignments };
    }
    return { status: 'unconfirmed', issues: [{ code: 'DESIGN_UNCONFIRMED', message: '实验单位与重复层级未确认；仅提供描述结果，不进行组间推断。' }], assignments };
  }
  if (!['independent', 'paired', 'repeated'].includes(design.kind)) {
    issues.push({ code: 'DESIGN_KIND_INVALID', message: '实验设计类型无效。' });
  }
  if (typeof design.controlGroup !== 'string' || !design.controlGroup.trim()) {
    issues.push({ code: 'CONTROL_GROUP_MISSING', message: '请明确指定实验设计中的对照组。' });
  }
  if (!Array.isArray(design.assignments)) {
    issues.push({ code: 'ASSIGNMENTS_INVALID', message: '实验单位映射必须是数组。' });
  } else {
    for (const assignment of design.assignments) {
      if (!assignment || typeof assignment.plate !== 'string' || typeof assignment.sample !== 'string' ||
          !assignment.sample.trim() || typeof assignment.unitId !== 'string' || !assignment.unitId.trim() ||
          typeof assignment.group !== 'string' || !assignment.group.trim()) {
        issues.push({ code: 'ASSIGNMENT_INVALID', message: '每个映射必须包含原始板号、样本名、实验单位 ID 和组别。' });
        continue;
      }
      const key = sampleKey(assignment);
      if (assignments.has(key)) {
        issues.push({ code: 'ASSIGNMENT_CONFLICT', message: '同一原始板号与样本名出现重复或冲突的映射。', sampleIds: [{ plate: assignment.plate, sample: assignment.sample }] });
      } else {
        assignments.set(key, assignment);
      }
    }
  }
  const identities = uniqueSampleIds(rows.filter((r) => r.sample));
  for (const identity of identities) {
    if (!assignments.has(sampleKey(identity))) {
      issues.push({ code: 'ASSIGNMENT_MISSING', message: '原始样本缺少实验单位映射。', sampleIds: [identity] });
    }
    const groups = new Set(rows.filter((r) => sampleKey(r) === sampleKey(identity)).map((r) => r.group).filter(Boolean));
    if (groups.size > 1) {
      issues.push({ code: 'SOURCE_GROUP_CONFLICT', message: '同一原始样本的数据行存在冲突组别；请先核对源数据。', sampleIds: [identity] });
    }
  }
  const active = identities.map((identity) => assignments.get(sampleKey(identity))).filter((a): a is ExperimentalUnitAssignment => !!a);
  if (!active.some((a) => a.group === design.controlGroup)) {
    issues.push({ code: 'CONTROL_GROUP_NOT_FOUND', message: '实验单位映射中没有可用的指定对照组。' });
  }
  if (design.kind === 'independent') {
    const groupsByUnit = new Map<string, Set<string>>();
    for (const assignment of active) {
      const groups = groupsByUnit.get(assignment.unitId) ?? new Set<string>();
      groups.add(assignment.group);
      groupsByUnit.set(assignment.unitId, groups);
    }
    for (const [unitId, groups] of groupsByUnit) {
      if (groups.size > 1) {
        issues.push({ code: 'UNIT_GROUP_CONFLICT', message: '独立设计中同一实验单位不能属于多个组；跨条件重复测量应选择相应设计。', unitId });
      }
    }
    const unitsByPair = new Map<string, { groups: Set<string>; unitIds: Set<string> }>();
    for (const row of rows) {
      const assignment = assignments.get(sampleKey(row));
      if (!row.pairId.trim() || !assignment) continue;
      const pair = unitsByPair.get(row.pairId) ?? { groups: new Set<string>(), unitIds: new Set<string>() };
      pair.groups.add(assignment.group);
      pair.unitIds.add(assignment.unitId);
      unitsByPair.set(row.pairId, pair);
    }
    for (const [pairId, pair] of unitsByPair) {
      if (pair.groups.size > 1 && pair.unitIds.size > 1) {
        issues.push({ code: 'PAIR_ID_DEPENDENCE', message: `原始配对 ID「${pairId}」关联了不同组的多个单位；不能按独立组推断，请核对配对或重复测量设计。` });
      }
    }
  }
  if (issues.length) return { status: 'invalid', issues, assignments };
  if (design.kind !== 'independent') {
    return { status: 'unsupported', issues: [{ code: 'DESIGN_UNSUPPORTED', message: '当前推断仅支持独立组设计；配对或重复测量保留描述结果，不产生独立组 p 值。' }], assignments };
  }
  return { status: 'confirmed', issues, assignments };
}

/**
 * Technical wells are averaged within each explicitly assigned unit and gene.
 * Only a confirmed independent design enables group inference, using one ΔCt
 * per unit and equal unit weights for the control baseline. Sample-level p
 * values are always null; paired/repeated and unconfirmed designs are descriptive.
 */
export function analyzeDeltaDeltaCt(rows: AnalysisRow[], config: AnalysisConfig): AnalysisOutput {
  const warnings: string[] = [];
  const nonExcluded = rows.filter((r) => !r.excluded);
  const ntcRows = nonExcluded.filter(isNtcRow);
  const effective = nonExcluded.filter((r) => !isNtcRow(r) && !isStandardRow(r));
  const design = resolveDesign(effective, config);
  const confirmed = design.status === 'confirmed';
  const controlGroup = config.experimentalDesign?.controlGroup ?? '';
  const samples = [...new Set(effective.map((r) => r.sample).filter(Boolean))].sort();
  const genes = [...new Set(effective.map((r) => r.target).filter(Boolean))].sort();
  const selectedRefGenes = [...new Set(config.refGenes)];
  const refGenes = selectedRefGenes.filter((g) => genes.includes(g));
  const targetGenes = genes.filter((g) => !refGenes.includes(g));
  const controls = confirmed
    ? [...new Set(effective.filter((r) => design.assignments.get(sampleKey(r))?.group === controlGroup).map((r) => r.sample))].sort()
    : config.controlSamples.filter((s) => samples.includes(s));
  if (refGenes.length === 0) warnings.push('未找到可用的内参基因（请确认基因名）。');
  if (controls.length === 0) warnings.push('未找到对照组样本（请确认对照组设置）。');
  const missingRef = config.refGenes.filter((g) => !genes.includes(g));
  if (missingRef.length) warnings.push(`内参基因未在数据中出现：${missingRef.join('、')}`);
  if (!confirmed) {
    const missingCtrl = config.controlSamples.filter((s) => !samples.includes(s));
    if (missingCtrl.length) warnings.push(`对照组样本未在数据中出现：${missingCtrl.join('、')}`);
  }

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


  interface UnitRows {
    sample: string;
    plate: string;
    unitId: string | null;
    sampleIds: SampleIdentity[];
    group: string;
    isControl: boolean;
    rows: AnalysisRow[];
  }
  const units = new Map<string, UnitRows>();
  for (const row of effective) {
    if (!row.sample || !row.target) continue;
    const assignment = confirmed ? design.assignments.get(sampleKey(row)) : undefined;
    // Preserve conflicting raw groups separately in descriptive fallback.
    const key = assignment ? JSON.stringify(['unit', assignment.unitId, assignment.group]) : JSON.stringify(['sample', row.plate, row.sample, row.group]);
    let unit = units.get(key);
    if (!unit) {
      unit = { sample: row.sample, plate: row.plate, unitId: assignment?.unitId ?? null, sampleIds: [],
        group: assignment?.group ?? row.group, isControl: assignment ? assignment.group === controlGroup : controls.includes(row.sample), rows: [] };
      units.set(key, unit);
    }
    unit.rows.push(row);
  }
  for (const unit of units.values()) {
    unit.sampleIds = uniqueSampleIds(unit.rows);
    unit.sample = [...new Set(unit.sampleIds.map((s) => s.sample))].join(' / ');
    unit.plate = [...new Set(unit.sampleIds.map((s) => s.plate))].join(' / ');
  }
  const effPct = (gene: string): number => {
    const value = config.efficiencies?.[gene];
    return value != null && Number.isFinite(value) ? value : 100;
  };
  const results: SampleTargetResult[] = [];
  // Each reference uses its own efficiency before geometric quantity pooling.
  // Keep this alongside the result identity, rather than keying by display names.
  const referenceLog2ByResult = new Map<SampleTargetResult, number>();
  for (const unit of units.values()) {
    const byGene = new Map<string, AnalysisRow[]>();
    for (const row of unit.rows) {
      if (!Number.isFinite(row.cq)) continue;
      byGene.set(row.target, [...(byGene.get(row.target) ?? []), row]);
    }
    const refMeans = refGenes.map((gene) => byGene.get(gene)).filter((rs): rs is AnalysisRow[] => !!rs?.length).map((rs) => mean(rs.map((r) => r.cq)));
    const missingUnitRefs = selectedRefGenes.filter((gene) => !byGene.get(gene)?.length);
    const refCq = refMeans.length && !(confirmed && missingUnitRefs.length) ? mean(refMeans) : null;
    if (confirmed && missingUnitRefs.length) {
      design.issues.push({ code: 'REFERENCE_INCOMPLETE', message: `实验单位 ${unit.unitId} 缺少选定内参 ${missingUnitRefs.join('、')}；该单位不进入组级 ΔCt 推断。`, unitId: unit.unitId!, sampleIds: unit.sampleIds });
    }
    if (refCq === null && refGenes.length && targetGenes.some((g) => byGene.has(g))) {
      warnings.push(`内参基因（${refGenes.join('、')}）在以下样本未检出：${unit.sample}——相关 ΔCt 无法计算，请更换或补充内参基因`);
    }
    for (const target of targetGenes) {
      const geneRows = byGene.get(target);
      if (!geneRows?.length) continue;
      const values = geneRows.map((r) => r.cq);
      const deltaCtValues = refCq === null ? [] : values.map((v) => v - refCq);
      const result: SampleTargetResult = {
        sample: unit.sample, plate: unit.plate, unitId: unit.unitId, sampleIds: unit.sampleIds,
        group: unit.group, target, isControl: unit.isControl, excluded: false,
        n: values.length, nTech: values.length, nBio: confirmed ? 1 : null,
        values, wells: geneRows.map((r) => r.well).filter(Boolean), meanCq: mean(values), sdCq: sd(values),
        refCq, deltaCt: refCq === null ? null : mean(values) - refCq, deltaCtValues,
        ddCt: null, foldChange: null, fcValues: [], fcMean: NaN, fcSd: NaN,
        pValue: null, pAdjusted: null, significance: '', statMethod: '',
      };
      results.push(result);
      if (refCq !== null) {
        const referenceLog2 = refGenes.filter((gene) => byGene.get(gene)?.length).map((gene) =>
          mean(byGene.get(gene)!.map((row) => row.cq)) * Math.log2(1 + effPct(gene) / 100));
        referenceLog2ByResult.set(result, mean(referenceLog2));
      }
    }
  }

  let anyEffMode = false;
  const groupResults: GroupTargetResult[] = [];
  for (const target of targetGenes) {
    const geneResults = results.filter((r) => r.target === target);
    const valid = geneResults.filter((r) => r.deltaCt != null && Number.isFinite(r.deltaCt));
    const controlResults = valid.filter((r) => r.isControl);
    // One contribution per unit (or per raw plate/sample in descriptive mode), never one per well.
    const ctrlMean = controlResults.length ? mean(controlResults.map((r) => r.deltaCt!)) : null;
    const ctTCtrl = controlResults.length ? mean(controlResults.map((r) => r.meanCq)) : null;
    const controlReferenceLog2 = controlResults.length ? mean(controlResults.map((r) => referenceLog2ByResult.get(r)!)) : null;
    const eTarget = 1 + effPct(target) / 100;
    const geneEffMode = Math.abs(eTarget - 2) > 1e-9 || refGenes.some((ref) => Math.abs(effPct(ref) - 100) > 1e-7);
    if (geneEffMode && ctrlMean !== null) anyEffMode = true;
    if (ctrlMean === null && geneResults.some((r) => r.isControl) && refGenes.length) {
      warnings.push(`对照组样本（${controls.join('、')}）的内参基因均未检出——无法计算 ΔΔCt，请改用其他内参基因`);
    }
    for (const result of valid) {
      if (ctrlMean === null) continue;
      result.ddCt = result.deltaCt! - ctrlMean;
      result.fcValues = geneEffMode
        ? result.values.map((v) => Math.pow(2, (ctTCtrl! - v) * Math.log2(eTarget)
          + referenceLog2ByResult.get(result)! - controlReferenceLog2!))
        : result.deltaCtValues.map((v) => Math.pow(2, -(v - ctrlMean)));
      result.fcMean = mean(result.fcValues);
      // Confirmed units contribute one quantity from their mean Cq. Preserve
      // the existing descriptive efficiency-corrected per-well FC mean; the
      // all-100% Livak path continues to transform mean delta-delta Ct.
      result.foldChange = !geneEffMode ? Math.pow(2, -result.ddCt) : confirmed
        ? Math.pow(2, (ctTCtrl! - result.meanCq) * Math.log2(eTarget)
          + referenceLog2ByResult.get(result)! - controlReferenceLog2!)
        : result.fcMean;
      result.fcSd = sd(result.fcValues);
      result.statMethod = geneEffMode ? '描述结果；FC 经 Pfaffl 效率校正' : '';
    }
    if (!confirmed) continue;
    // Keep groups with no usable target data visible; do not silently narrow the design.
    const groups = [...new Set([...units.values()].map((unit) => unit.group))].sort();
    const geneGroups: GroupTargetResult[] = groups.map((group) => {
      const members = valid.filter((r) => r.group === group);
      const deltaCtValues = members.map((r) => r.deltaCt!);
      const fcValues = members.map((r) => r.foldChange).filter((v): v is number => v != null && Number.isFinite(v));
      const deltaCtMean = mean(deltaCtValues);
      const ddCt = ctrlMean === null || !members.length ? null : deltaCtMean - ctrlMean;
      return {
        group, target, isControl: group === controlGroup,
        nBio: members.length, nTech: members.reduce((sum, r) => sum + r.nTech, 0),
        unitIds: members.map((r) => r.unitId!), sampleIds: uniqueSampleIds(members.flatMap((r) => r.sampleIds)),
        deltaCtValues, deltaCtMean, deltaCtSd: sd(deltaCtValues), ddCt,
        foldChange: ddCt === null ? null : geneEffMode
          ? Math.pow(2, (ctTCtrl! - mean(members.map((r) => r.meanCq))) * Math.log2(eTarget)
            + mean(members.map((r) => referenceLog2ByResult.get(r)!)) - controlReferenceLog2!)
          : Math.pow(2, -ddCt),
        fcValues, fcMean: mean(fcValues), fcSd: sd(fcValues),
        pValue: null, pAdjusted: null, anovaPValue: null, significance: '', statMethod: '',
      };
    });
    const control = geneGroups.find((g) => g.isControl);
    const eligible = geneGroups.length >= 2 && !!control && geneGroups.every((g) => g.nBio >= 2);
    if (!eligible && geneGroups.length >= 2) {
      design.issues.push({ code: 'INSUFFICIENT_BIOLOGICAL_REPLICATION', message: `${target}：每个比较组至少需要 2 个具有有效 ΔCt 的独立实验单位；不计算 p 值。` });
    }
    if (eligible && control) {
      if (geneGroups.length === 2) {
        const treatment = geneGroups.find((g) => !g.isControl)!;
        if (control.deltaCtSd > 0 || treatment.deltaCtSd > 0) {
          const test = welchTTest(treatment.deltaCtValues, control.deltaCtValues);
          treatment.pValue = Number.isFinite(test.p) ? test.p : null;
          treatment.statMethod = `Welch t（t=${test.t.toFixed(2)}, df=${test.df.toFixed(1)}）`;
        }
      } else {
        // Include the control group in both ANOVA and its pooled within-group variance.
        const anova = oneWayAnova(geneGroups.map((g) => g.deltaCtValues));
        if (Number.isFinite(anova.p) && anova.df2 > 0 && anova.msWithin > 0) {
          for (const group of geneGroups) group.anovaPValue = anova.p;
          const treatments = geneGroups.filter((g) => !g.isControl);
          const comparisons = treatments.map((group) => ({
            b: Math.sqrt(group.nBio / control.nBio),
            tAbs: Math.abs((group.deltaCtMean - control.deltaCtMean) /
              (Math.sqrt(anova.msWithin) * Math.sqrt(1 / group.nBio + 1 / control.nBio))),
          }));
          const adjusted = dunnettAdjustedP(comparisons, anova.df2);
          treatments.forEach((group, index) => {
            group.pAdjusted = Number.isFinite(adjusted[index]) ? adjusted[index] : null;
            group.statMethod = `单因素 ANOVA（F=${anova.f.toFixed(2)}, df=${anova.df1}/${anova.df2}）；Dunnett vs 对照`;
          });
        }
      }
      if (geneGroups.filter((g) => !g.isControl).every((g) => g.pValue === null && g.pAdjusted === null)) {
        design.issues.push({ code: 'STATISTICAL_VARIANCE_UNAVAILABLE', message: `${target}：单位级方差不足或统计量不可计算；不报告 p 值。` });
      }
    }
    for (const group of geneGroups) {
      if (!group.isControl) group.significance = group.pValue === null && group.pAdjusted === null ? '' : significanceStars(group.pAdjusted ?? group.pValue);
      if (group.statMethod && geneEffMode) group.statMethod += '；FC 经 Pfaffl 效率校正';
    }
    groupResults.push(...geneGroups);
  }
  results.sort((a, b) => a.target.localeCompare(b.target) || Number(b.isControl) - Number(a.isControl) || a.sample.localeCompare(b.sample) || a.plate.localeCompare(b.plate));
  groupResults.sort((a, b) => a.target.localeCompare(b.target) || Number(b.isControl) - Number(a.isControl) || a.group.localeCompare(b.group));
  return {
    results, groupResults, designStatus: design.status, designIssues: design.issues,
    refGenesUsed: refGenes, controlSamples: controls, warnings, ntcReport,
    effMode: anyEffMode, efficiencies: { ...(config.efficiencies ?? {}) },
  };
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
