/**
 * wisplab pcr runner：由 pcr-workbench 仓库的 tsx 执行。
 * argv[2] = JSON {files:[路径], refGenes, controlSamples, efficiencies}
 * CSV/TXT 自带解析（含引号转义）；xlsx/rdml 走仓库 XLSX 读取。
 * 结果以 @@WISPLAB@@{json} 单行输出到 stdout。
 */
import { readFileSync } from "node:fs";
import { extractRows, analyzeDeltaDeltaCt } from "<PCR>/src/core/analysis.ts";
import { sniff } from "<PCR>/src/core/sniff.ts";

function loadMatrix(path) {
  const text = readFileSync(path, "utf-8");
  if (!/\.(csv|txt|tsv)$/i.test(path)) {
    // xlsx 等：走仓库的 XLSX 包
    return import("<PCR>/node_modules/xlsx/xlsx.mjs").then((XLSX) => {
      const wb = XLSX.read(text, { type: "string", raw: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
      return json.map((row) => (row ?? []).map((v) => (v == null ? "" : String(v).trim()))).filter((r) => r.some((c) => c.length > 0));
    });
  }
  const rows = [];
  let row = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i += 1; }
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cur); cur = "";
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.length > 0)) rows.push(row);
  return rows;
}

const payload = JSON.parse(process.argv[2]);
const images = [];
for (const path of payload.files) {
  const name = path.split("/").pop() ?? path;
  try {
    const matrix = await loadMatrix(path);
    const r = sniff(matrix);
    const rows = extractRows(matrix.slice(r.headerRow + 1), r.mapping);
    const out = analyzeDeltaDeltaCt(rows, {
      refGenes: payload.refGenes,
      controlSamples: payload.controlSamples,
      efficiencies: Object.keys(payload.efficiencies ?? {}).length ? payload.efficiencies : undefined,
      qc: { minCq: NaN, maxCq: NaN, absDev: NaN, repSD: NaN },
    });
    images.push({
      file: name,
      format: r.format ?? null,
      refGenesUsed: out.refGenesUsed,
      controlSamples: out.controlSamples,
      effMode: out.effMode,
      warnings: out.warnings,
      ntcReport: out.ntcReport,
      results: out.results,
    });
  } catch (err) {
    images.push({ file: name, error: String(err.message ?? err) });
  }
}

console.log("@@WISPLAB@@" + JSON.stringify({ files: images }));
