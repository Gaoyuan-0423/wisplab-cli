#!/usr/bin/env node
/**
 * wisplab MCP server — 把 WispLab 三引擎暴露为 MCP 工具（stdio，零运行时依赖）。
 * 工具：wb_quantify / ihc_quantify / if_colocalize / pcr_analyze / pcr_verify。
 * 配置：WISPLAB_CONFIG 或 ./wisplab.config.json（repos.wb/ihc/pcr；allowPaths 可选）。
 * 接入：ZCode/Codex/WispScience 的 mcpServers 配置 command=node args=[本文件]。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const CLI_DIR = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(CLI_DIR, "package.json"));
const lib = await import(join(CLI_DIR, "lib.mjs"));

const cfgPathIdx = process.argv.indexOf("--config");
const cfg = lib.loadConfig(cfgPathIdx > 0 ? process.argv[cfgPathIdx + 1] : undefined);
const HOME = process.env.HOME ?? "";
const ALLOW = (cfg.allowPaths ?? [join(HOME, "Downloads"), "/tmp", HOME]).map((p) => resolve(p));

/** 路径允许列表：agent 传来的文件必须落在允许目录内（防止被诱导读写任意路径）。 */
function assertAllowed(paths) {
  for (const p of paths) {
    const r = resolve(p);
    if (!ALLOW.some((dir) => r === dir || r.startsWith(dir + sep)))
      throw new Error(`路径不在允许目录内（allowPaths=${ALLOW.join(", ")}）：${r}`);
  }
}
function readFiles(paths) {
  for (const p of paths) if (!existsSync(p)) throw new Error(`文件不存在：${p}`);
}

const TOOLS = [
  {
    name: "wb_quantify",
    description:
      "Quantify Western blot membrane image(s) with the blot-workbench engine: lane proposal (optionally restricted to a manually located panel strip), rolling-ball or local background subtraction, dark/light signal, per-lane net signal and ratios vs a control lane. Input: PNG/TIFF paths. Vendor-copyrighted images stay local.",
    inputSchema: {
      type: "object",
      required: ["files"],
      properties: {
        files: { type: "array", items: { type: "string" }, description: "图像文件绝对路径（PNG/TIFF）" },
        lanes: { type: "integer", description: "泳道数；省略则 3–8 自动尝试" },
        strip: { type: "string", description: "多面板图的人工面板条带 'y,h,x0,x1'（像素）；单面板省略" },
        bg: { type: "string", enum: ["local", "rolling"], description: "背景扣除方法（默认 local）" },
        radius: { type: "integer", description: "rolling ball 半径（默认 50）" },
        signal: { type: "string", enum: ["dark", "light"], description: "信号极性（默认 dark，化学发光/荧光亮带用 light）" },
        controlLane: { type: "integer", description: "对照泳道号（默认 1）" },
      },
    },
    call: (a) => lib.runWb({
      files: a.files ?? [], lanes: a.lanes ?? null, strip: a.strip ?? null,
      bg: a.bg === "rolling" ? "rolling" : "local", radius: a.radius ?? 50,
      signal: a.signal ?? "dark", controlLane: a.controlLane ?? 1,
    }),
  },
  {
    name: "ihc_quantify",
    description:
      "Quantify IHC / H&E / Masson histology image(s) with the pathology-workbench engine: Ruifrok colour deconvolution, background subtraction, positivity threshold (per-image Otsu or control-slide calibration), nuclei segmentation, H-score. Returns whole-image metrics. JPEG/TIFF/PNG.",
    inputSchema: {
      type: "object",
      required: ["files"],
      properties: {
        files: { type: "array", items: { type: "string" }, description: "图像文件绝对路径" },
        profile: { type: "string", enum: ["h_dab", "h_eosin", "masson"], description: "染色预设（默认 h_dab）" },
        controlTif: { type: "string", description: "未染色对照片路径；提供则按 0.1% 假阳率标定阈值" },
      },
    },
    call: (a) => lib.runIhc({ files: a.files ?? [], coloc: false, profile: a.profile ?? "h_dab", controlTif: a.controlTif ?? null }),
  },
  {
    name: "if_colocalize",
    description:
      "Immunofluorescence colocalization on duplex/multiplex fluorescence images: per-channel background+Otsu thresholds, Pearson (all and masked), Manders M1/M2. Default channels R vs G.",
    inputSchema: {
      type: "object",
      required: ["files"],
      properties: { files: { type: "array", items: { type: "string" }, description: "图像文件绝对路径" } },
    },
    call: (a) => lib.runIhc({ files: a.files ?? [], coloc: true, profile: "if_coloc", controlTif: null }),
  },
  {
    name: "pcr_analyze",
    description:
      "Analyze qPCR table(s) (QuantStudio/CFX/LC480 CSV export, RDML-adjacent tabular) with the pcr-workbench engine: replicate pooling, multi-reference-gene normalization, ΔΔCt (Livak) or Pfaffl efficiency-corrected fold change, NTC report, Welch t / ANOVA+Dunnett on individual ΔCt.",
    inputSchema: {
      type: "object",
      required: ["files"],
      properties: {
        files: { type: "array", items: { type: "string" }, description: "数据表绝对路径（CSV/TXT；含引号转义的仪器导出均可）" },
        refGenes: { type: "array", items: { type: "string" }, description: "内参基因名（Target 列中的名字）" },
        controlSamples: { type: "array", items: { type: "string" }, description: "对照样本名（Sample 列中的名字）" },
        efficiencies: { type: "object", description: "每基因扩增效率百分比，如 {\"LDHA\":200}；缺省 100（Livak）" },
      },
    },
    call: (a) => lib.runPcr({
      files: a.files ?? [], refGenes: a.refGenes ?? [], controlSamples: a.controlSamples ?? [],
      efficiencies: a.efficiencies ?? {},
    }),
  },
  {
    name: "pcr_verify",
    description:
      "Run the independent-reference verification for the pcr engine (4 scenarios: Livak/Pfaffl/Welch/ANOVA/Dunnett vs a from-scratch Python implementation on real QuantStudio data). Pass line: ΔΔCt/Pfaffl ≤1e-09, Welch/ANOVA ≤1e-08, deep-tail Dunnett inside [raw p, k·raw p].",
    inputSchema: {
      type: "object",
      properties: { dir: { type: "string", description: "验证材料目录（默认 ~/Downloads/WispLab预印本验证/pcr）" } },
    },
    call: (a) => lib.runVerifyPcr(a.dir),
  },
];

function dispatchTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`未知工具：${name}`);
  if (name !== "pcr_verify") {
    assertAllowed(a_files(args));
    readFiles(a_files(args));
  } else if (a_dir(args)) {
    assertAllowed([resolve(a_dir(args))]);
  }
  return tool.call(args ?? {});
}
function a_files(a) { return Array.isArray(a?.files) ? a.files : []; }
function a_dir(a) { return typeof a?.dir === "string" ? a.dir : null; }

function textResult(obj) {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) handleMessage(line);
  }
});
process.stdin.on("end", () => process.exit(0));

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function handleMessage(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.id === "undefined") return; // 通知忽略
  const respond = (result) => send({ jsonrpc: "2.0", id: msg.id, result });
  const respondError = (code, message) => send({ jsonrpc: "2.0", id: msg.id, error: { code, message } });

  try {
    switch (msg.method) {
      case "initialize":
        respond({
          protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "wisplab", title: "WispLab engines (WB / IHC / IF / qPCR)", version: "0.1.0" },
        });
        return;
      case "ping":
        respond({});
        return;
      case "tools/list":
        respond({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        return;
      case "tools/call": {
        const { name, arguments: args } = msg.params ?? {};
        try {
          const result = dispatchTool(name, args ?? {});
          respond({ ...textResult(result), isError: false });
        } catch (err) {
          respond({ ...textResult(`wisplab 工具错误：${err.message}`), isError: true });
        }
        return;
      }
      default:
        respondError(-32601, `method not found: ${msg.method}`);
    }
  } catch (err) {
    respondError(-32603, err.message);
  }
}
