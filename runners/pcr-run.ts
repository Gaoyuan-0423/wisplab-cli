/**
 * wisplab pcr runner：由 pcr-workbench 仓库的 tsx 执行。
 * argv[2] = JSON {files:[路径], refGenes, controlSamples, efficiencies}
 * 复用引擎文件解析器：Excel 二进制、UTF-8/GBK 文本与 RDML。
 * 结果以 @@WISPLAB@@{json} 单行输出到 stdout。
 */
import { readFileSync } from "node:fs";
import { extractRows, analyzeDeltaDeltaCt, isNtcRow, isStandardRow } from "<PCR>/src/core/analysis.ts";
import { sniff } from "<PCR>/src/core/sniff.ts";
import { readInputFile } from "<PCR>/src/core/parse.ts";

import { computeQcFlags } from "<PCR>/src/core/qc.ts";
import { mean, sd, welchTTest } from "<PCR>/src/core/stats.ts";
import { preparePcrRows } from "<CLI>/pcr-qc.mjs";
import { normalizePcrResult } from "<CLI>/pcr-result.mjs";

import { analyzeBiologicalGroups } from "<CLI>/pcr-groups.mjs";
import { parsePcrImport } from "<CLI>/pcr-import.mjs";

const payload = JSON.parse(process.argv[2]);
const images = [];
for (const path of payload.files) {
  const name = path.split("/").pop() ?? path;
  const grouped = payload.biologicalDesign != null;
  const unitDesign = payload.experimentalDesign != null;
  const primaryKind = grouped ? "biological-groups" : unitDesign ? "experimental-units" : "descriptive-only";
  const primaryUnit = grouped ? "biological-sample" : unitDesign ? "experimental_unit" : "descriptive_only";
  const record = payload.mode === "preview" ? { file: name, status: "error" } : { file: name, primaryAnalysis: {
    kind: primaryKind,
    statisticalUnit: primaryUnit,
    status: "error", summaries: [], comparisons: [], method: null, multiplicityFamilySize: null, error: "Analysis did not complete",
  } };
  try {
    const input = await readInputFile(new File([readFileSync(path)], name));
    const imported = parsePcrImport(input, payload.importOptions, { sniff, extractRows });
    const { rows } = imported, { sheet } = imported.report;
    Object.assign(record, { inputKind: input.kind, sheet, format: imported.format, warnings: imported.report.warnings });
    if (payload.mode === "preview") {
      Object.assign(record, { status: "success", importPreview: imported.preview });
      images.push(record);
      continue;
    }
    record.importReport = imported.report;
    if (!imported.report.canAnalyze) throw new Error(imported.report.errors.join("; "));
    const efficiencies = {
      ...(input.kind === "rdml" ? input.targetEfficiencies : {}),
      ...(payload.efficiencies ?? {}),
    };
    Object.assign(record, { efficiencies });
    const prepared = preparePcrRows(rows, payload, { computeQcFlags, sd, isNtcRow, isStandardRow });
    record.qcReport = prepared.report;
    const out = analyzeDeltaDeltaCt(prepared.rows, {
      refGenes: payload.refGenes,
      controlSamples: payload.controlSamples,
      efficiencies: Object.keys(efficiencies).length ? efficiencies : undefined,
      qc: prepared.settings,
      experimentalDesign: payload.experimentalDesign,
    });
    const adapted = normalizePcrResult(out, payload.experimentalDesign);
    Object.assign(record, {
      file: name,
      inputKind: input.kind,
      sheet,
      format: imported.format,
      refGenesUsed: out.refGenesUsed,
      controlSamples: out.controlSamples,
      effMode: out.effMode,
      efficiencies: out.efficiencies,
      qcReport: grouped ? prepared.report : { ...prepared.report, replication: adapted.replication },
      ...(!grouped ? {
        experimentalDesign: payload.experimentalDesign ?? null,
        designStatus: adapted.designStatus,
        designIssues: adapted.designIssues,
        groupResults: adapted.groupResults,
      } : {}),
      inferenceMode: grouped ? 'descriptive_only' : adapted.inferenceMode,
      ...(out.results.length === 0 ? { error: "No relative-expression results; inspect reference/control names and QC exclusions / 无相对表达结果，请检查内参、对照及排除行" } : {}),
      warnings: [
        ...imported.report.warnings,
        grouped ? prepared.report.replication.note : adapted.replication.note,
        ...(!grouped ? adapted.designIssues.map(issue => issue.message) : []),
        ...(prepared.report.flaggedRowIds.length ? [`QC flagged rows / 质控标记行: ${prepared.report.flaggedRowIds.join(", ")}`] : []),
        ...(prepared.report.replicateGroups.some(group => group.highSD) ? ["High replicate SD; groups are reported, not automatically removed / 复孔SD超限仅报告"] : []),
        ...out.warnings,
      ],
      ntcReport: out.ntcReport,
      results: adapted.results,
    });
    // Retain the independently implemented biologicalDesign pathway, including pairing.
    // Engine experimentalDesign and biologicalDesign are mutually exclusive at the API boundary.
    if (grouped) {
      record.biologicalGroups = analyzeBiologicalGroups(prepared.rows, { ...payload, efficiencies }, { mean, sd, welchTTest, isNtcRow, isStandardRow });
      record.inferenceMode = record.biologicalGroups.comparisons.some(comparison => Number.isFinite(comparison.pValue))
        ? 'biological_groups' : 'descriptive_only';
      if (!record.biologicalGroups.comparisons.some(comparison => Number.isFinite(comparison.log2FoldChange))) {
        record.error = "No usable biological treatment/control effect; inspect missing targets/references, complete pairs and QC exclusions / 无可用生物学处理与对照效应，请检查靶标/内参缺失、完整配对及质控排除";
      }
    } else if (unitDesign && ['invalid', 'unsupported'].includes(adapted.designStatus)) {
      record.error = adapted.designIssues.map(issue => issue.message).join('; ') || `Experimental design is ${adapted.designStatus}`;
    }
    const confirmed = adapted.designStatus === 'confirmed';
    const unitGroups = unitDesign && confirmed ? adapted.groupResults : [];
    record.primaryAnalysis = {
      kind: primaryKind,
      statisticalUnit: grouped ? primaryUnit : confirmed ? 'experimental_unit' : 'descriptive_only',
      status: record.error ? "error" : "success",
      summaries: grouped ? record.biologicalGroups.summaries : unitDesign && confirmed ? unitGroups : adapted.results,
      comparisons: grouped ? record.biologicalGroups.comparisons : unitGroups.filter(row => row.group !== payload.experimentalDesign.controlGroup),
      method: grouped ? record.biologicalGroups.method : unitDesign && confirmed ? "See statMethod in each experimental-unit group result" : "Technical descriptions only; no well-level inference",
      multiplicityFamilySize: grouped ? record.biologicalGroups.multiplicityFamilySize : null,
      error: record.error ?? null,
    };
  } catch (err) {
    record.error = String(err.message ?? err);
    if (record.primaryAnalysis) record.primaryAnalysis.error = record.error;
    // The requested statistical unit stays explicit even if grouping fails.
    // Earlier parsing, QC, NTC and legacy results remain available for diagnosis only.
  }
  images.push(record);
}

console.log("@@WISPLAB@@" + JSON.stringify({ files: images }));
