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

import { analyzeBiologicalGroups } from "<CLI>/pcr-groups.mjs";
import { parsePcrImport } from "<CLI>/pcr-import.mjs";

const payload = JSON.parse(process.argv[2]);
const images = [];
for (const path of payload.files) {
  const name = path.split("/").pop() ?? path;
  const grouped = payload.biologicalDesign != null;
  const record = payload.mode === "preview" ? { file: name, status: "error" } : { file: name, primaryAnalysis: {
    kind: grouped ? "biological-groups" : "well-level",
    statisticalUnit: grouped ? "biological-sample" : "well",
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
    });
    Object.assign(record, {
      file: name,
      inputKind: input.kind,
      sheet,
      format: imported.format,
      refGenesUsed: out.refGenesUsed,
      controlSamples: out.controlSamples,
      effMode: out.effMode,
      efficiencies: out.efficiencies,
      qcReport: prepared.report,
      ...(out.results.length === 0 ? { error: "No relative-expression results; inspect reference/control names and QC exclusions / 无相对表达结果，请检查内参、对照及排除行" } : {}),
      warnings: [
        ...imported.report.warnings,
        prepared.report.replication.note,
        ...(prepared.report.flaggedRowIds.length ? [`QC flagged rows / 质控标记行: ${prepared.report.flaggedRowIds.join(", ")}`] : []),
        ...(prepared.report.replicateGroups.some(group => group.highSD) ? ["High replicate SD; groups are reported, not automatically removed / 复孔SD超限仅报告"] : []),
        ...out.warnings,
      ],
      ntcReport: out.ntcReport,
      results: out.results,
    });
    record.biologicalGroups = analyzeBiologicalGroups(prepared.rows, { ...payload, efficiencies }, { mean, sd, welchTTest, isNtcRow, isStandardRow });
    if (grouped && !record.biologicalGroups.comparisons.some(comparison => Number.isFinite(comparison.log2FoldChange))) {
      record.error = "No usable biological treatment/control effect; inspect missing targets/references, complete pairs and QC exclusions / 无可用生物学处理与对照效应，请检查靶标/内参缺失、完整配对及质控排除";
    }
    record.primaryAnalysis = {
      kind: grouped ? "biological-groups" : "well-level",
      statisticalUnit: grouped ? "biological-sample" : "well",
      status: record.error ? "error" : "success",
      summaries: grouped ? record.biologicalGroups.summaries : out.results,
      comparisons: grouped ? record.biologicalGroups.comparisons : out.results.filter(row => !row.isControl).map(row => ({
        sample: row.sample, target: row.target, controlSamples: out.controlSamples,
        pValue: row.pValue, pAdjusted: row.pAdjusted, statMethod: row.statMethod,
      })),
      method: grouped ? record.biologicalGroups.method : "See statMethod in each well-level comparison",
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
