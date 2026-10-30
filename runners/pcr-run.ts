/**
 * wisplab pcr runner：由 pcr-workbench 仓库的 tsx 执行。
 * argv[2] = JSON {files:[路径], refGenes, controlSamples, efficiencies}
 * 复用引擎文件解析器：Excel 二进制、UTF-8/GBK 文本与 RDML。
 * 结果以 @@WISPLAB@@{json} 单行输出到 stdout。
 */
import { readFileSync } from "node:fs";
import { extractRows, analyzeDeltaDeltaCt } from "<PCR>/src/core/analysis.ts";
import { sniff } from "<PCR>/src/core/sniff.ts";
import { readInputFile, sheetToRawMatrix } from "<PCR>/src/core/parse.ts";

const payload = JSON.parse(process.argv[2]);
const images = [];
for (const path of payload.files) {
  const name = path.split("/").pop() ?? path;
  try {
    const input = await readInputFile(new File([readFileSync(path)], name));
    const sheet = input.kind === "workbook" ? input.sheetNames[0] : null;
    if (input.kind === "workbook" && !sheet) throw new Error("数据文件没有工作表 / No worksheet found");
    const matrix = input.kind === "rdml" ? input.matrix : sheetToRawMatrix(input.wb, sheet);
    const r = sniff(matrix);
    if (r.mapping.sample < 0 || r.mapping.target < 0 || r.mapping.cq < 0)
      throw new Error("无法识别样本、靶标与 Cq 列 / Sample, target and Cq columns are required");
    const rows = extractRows(matrix.slice(r.headerRow + 1), r.mapping);
    if (!rows.length) throw new Error("没有可分析的数据行 / No analyzable rows");
    const efficiencies = {
      ...(input.kind === "rdml" ? input.targetEfficiencies : {}),
      ...(payload.efficiencies ?? {}),
    };
    const out = analyzeDeltaDeltaCt(rows, {
      refGenes: payload.refGenes,
      controlSamples: payload.controlSamples,
      efficiencies: Object.keys(efficiencies).length ? efficiencies : undefined,
      qc: { minCq: NaN, maxCq: NaN, absDev: NaN, repSD: NaN },
    });
    images.push({
      file: name,
      inputKind: input.kind,
      sheet,
      format: r.format ?? null,
      refGenesUsed: out.refGenesUsed,
      controlSamples: out.controlSamples,
      effMode: out.effMode,
      efficiencies: out.efficiencies,
      warnings: [
        ...out.warnings,
        ...(input.kind === "workbook" && input.sheetNames.length > 1
          ? [`仅分析首个工作表 / Only the first worksheet was analyzed: ${sheet}`] : []),
      ],
      ntcReport: out.ntcReport,
      results: out.results,
    });
  } catch (err) {
    images.push({ file: name, error: String(err.message ?? err) });
  }
}

console.log("@@WISPLAB@@" + JSON.stringify({ files: images }));
