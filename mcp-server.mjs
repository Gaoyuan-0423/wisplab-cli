#!/usr/bin/env node
/** WispLab MCP over stdio: legacy initialization and 2026-07-28 per-request metadata. */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import * as lib from "./lib.mjs";
import { runAnalysisJob } from "./runtime-controls.mjs";
import { roiManifestSchema } from "./image-review.mjs";
import { normalizeBiologicalDesign } from "./pcr-groups.mjs";
import { normalizePcrImportOptions } from "./pcr-import.mjs";

const CLI_DIR = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(CLI_DIR, "package.json"), "utf8"));
const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SUPPORTED_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS];
const META = "io.modelcontextprotocol/";
const SERVER_INFO = { name: "wisplab", title: "WispLab engines (WB / IHC / IF / qPCR)", version };
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function expandPath(path) {
  return resolve(path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
}

// Check resolved filesystem targets, including symlinked inputs and verification scripts.
function checkedPath(path, roots, kind = "file") {
  const expanded = expandPath(path);
  if (!existsSync(expanded)) throw new Error(`Path does not exist / 路径不存在：${expanded}`);
  const target = realpathSync(expanded);
  if (!roots.some((root) => {
    const rel = relative(root, target);
    return rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel));
  })) throw new Error(`Path outside allowPaths / 路径不在允许目录内：${target}`);
  const stat = statSync(target);
  if (kind === "file" ? !stat.isFile() : !stat.isDirectory())
    throw new Error(`Expected ${kind} / 路径类型错误：${target}`);
  return target;
}

// Validate the JSON Schema subset used by this server's fixed tool definitions.
function validate(value, schema, label = "arguments") {
  if (schema.anyOf) {
    for (const option of schema.anyOf) {
      try { validate(value, option, label); return; } catch {}
    }
    throw new Error(`${label}: expected one of ${schema.anyOf.map(option => option.type).join(" | ")}`);
  }
  const validType = schema.type === "object" ? isObject(value)
    : schema.type === "array" ? Array.isArray(value)
    : schema.type === "integer" ? Number.isInteger(value)
    : schema.type === "number" ? typeof value === "number" && Number.isFinite(value)
    : typeof value === schema.type;
  if (!validType) throw new Error(`${label}: expected ${schema.type}`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${label}: expected ${schema.enum.join(" | ")}`);
  if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`${label}: must be >= ${schema.minimum}`);
  if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) throw new Error(`${label}: must be > ${schema.exclusiveMinimum}`);
  if (schema.minLength && value.trim().length < schema.minLength) throw new Error(`${label}: must not be empty`);
  if (schema.type === "array") {
    if (schema.minItems && value.length < schema.minItems) throw new Error(`${label}: at least ${schema.minItems} item required`);
    if (schema.maxItems && value.length > schema.maxItems) throw new Error(`${label}: at most ${schema.maxItems} items allowed`);
    value.forEach((item, i) => validate(item, schema.items, `${label}[${i}]`));
  }
  if (schema.type === "object") {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new Error(`${label}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      const child = schema.properties?.[key];
      if (child) validate(item, child, `${label}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`${label}.${key}: unknown argument`);
      else if (isObject(schema.additionalProperties)) validate(item, schema.additionalProperties, `${label}.${key}`);
    }
  }
}

const runtimeSchema = { type: "object", additionalProperties: false, properties: {
  timeoutMs: { type: "integer", minimum: 1, description: "Batch deadline in milliseconds (default 300000)" },
  fileTimeoutMs: { type: "integer", minimum: 1, description: "IHC/IF image deadline in milliseconds (default 120000)" },
} };

const batchRuntimeSchema = { ...runtimeSchema, properties: { timeoutMs: runtimeSchema.properties.timeoutMs } };
const columnSelectorSchema = { anyOf: [{type:"string",minLength:1},{type:"integer",minimum:1}],
  description:"Exact header name or 1-based column number / 准确表头名称或从1开始的列号" };
const pcrImportSchema = { type:"object",additionalProperties:false,properties:{
  sheet:{type:"string",minLength:1,description:"Exact sheet name; numeric strings are names, not indices / 准确工作表名，数字字符串也按名称处理"},
  headerRow:{type:"integer",minimum:1,description:"1-based physical source row, including blank rows / 包含空白行的物理表头行号"},
  columns:{type:"object",additionalProperties:false,required:["sample","target","cq"],
    properties:Object.fromEntries(["plate","well","sample","group","pairId","target","task","cq","quantity"].map(key=>[key,columnSelectorSchema]))},
} };

function toolsFor(engine) {
return [
  {
    name: "wb_quantify",
    description:
      "Quantify Western blot membrane image(s) with the blot-workbench engine: lane proposal (optionally restricted to a manually located panel strip), rolling-ball or local background subtraction, dark/light signal, per-lane net signal and ratios vs a control lane. Input: PNG/TIFF paths. Vendor-copyrighted images stay local.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["files"],
      properties: {
        runtime: batchRuntimeSchema,
        files: { type: "array", minItems: 1, items: { type: "string", minLength: 1 }, description: "图像文件绝对路径（PNG/TIFF）" },
        lanes: { type: "integer", minimum: 1, description: "泳道数；省略则 3–8 自动尝试" },
        strip: { type: "string", description: "多面板图的人工面板条带 'y,h,x0,x1'（像素）；单面板省略" },
        bg: { type: "string", enum: ["local", "rolling"], description: "背景扣除方法（默认 local）" },
        radius: { type: "integer", minimum: 1, description: "rolling ball 半径（默认 50）" },
        signal: { type: "string", enum: ["dark", "light"], description: "信号极性（默认 dark，化学发光/荧光亮带用 light）" },
        controlLane: { type: "integer", minimum: 1, description: "对照泳道号（默认 1）" },
      },
    },
    call: (a) => engine.runWb({
      runtime: a.runtime, files: a.files, lanes: a.lanes ?? null, strip: a.strip ?? null,
      bg: a.bg ?? "local", radius: a.radius ?? 50,
      signal: a.signal ?? "dark", controlLane: a.controlLane ?? 1,
    }),
  },
  {
    name: "ihc_quantify",
    description:
      "Quantify IHC / H&E / Masson histology image(s): colour deconvolution, positivity threshold, nuclei counts and H-score. Optional SHA-bound source-pixel ROI import, nucleus center export, mpp and local review HTML/PNGs. Overlay shows positive stain, not nuclear contours. JPEG/TIFF/PNG.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["files"],
      properties: {
        runtime: runtimeSchema,
        files: { type: "array", minItems: 1, items: { type: "string", minLength: 1 }, description: "图像文件绝对路径" },
        profile: { type: "string", enum: ["h_dab", "h_eosin", "masson"], description: "染色预设（默认 h_dab）" },
        controlTif: { type: "string", minLength: 1, description: "H-DAB 未染色对照片路径；按 0.1% 假阳率标定阈值（仅 h_dab）" },
        roiManifest: { ...roiManifestSchema, description: "SHA-256-bound source-pixel rectangles / 与原图哈希绑定的矩形 ROI" },
        mpp: { type: "number", exclusiveMinimum: 0, description: "Original source pixel size in µm/px / 原图像素尺寸" },
        includeNuclei: { type: "boolean", description: "Export nucleus centers in working coordinates / 导出工作图核中心坐标" },
        reviewDir: { type: "string", minLength: 1, description: "Existing local output directory inside allowPaths; creates a new review subdirectory / 已存在的本地输出目录" },
      },
    },
    call: (a) => engine.runIhc({ runtime: a.runtime, files: a.files ?? [], coloc: false, profile: a.profile ?? "h_dab", controlTif: a.controlTif ?? null,
      roiManifest: a.roiManifest ?? null, mpp: a.mpp ?? null, includeNuclei: a.includeNuclei ?? false, reviewDir: a.reviewDir ?? null }),
  },
  {
    name: "if_colocalize",
    description:
      "Immunofluorescence colocalization on duplex/multiplex fluorescence images: per-channel background+Otsu thresholds, Pearson (all and masked), Manders M1/M2. Default channels R vs G.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["files"],
      properties: {
        runtime: runtimeSchema,
        files: { type: "array", minItems: 1, items: { type: "string", minLength: 1 }, description: "图像文件绝对路径" },
        channels: { type: "array", minItems: 2, maxItems: 2, items: { type: "string", enum: ["R", "G", "B"] }, description: "Two distinct RGB channels, default R,G / 两个不同 RGB 通道" },
        reviewDir: { type: "string", minLength: 1, description: "Existing local output directory inside allowPaths / 已存在的本地输出目录" },
      },
    },
    call: (a) => engine.runIhc({ runtime: a.runtime, files: a.files ?? [], coloc: true, profile: "if_coloc", controlTif: null, channels: a.channels ?? null, reviewDir: a.reviewDir ?? null }),
  },
  {
    name: "pcr_analyze",
    description:
      "Analyze qPCR tables or RDML with optional exact sheet/column mapping. One reference is sufficient. Explicit biological groups use unpaired Welch or paired t inference with 95% log2FC/FC intervals and Holm correction; technical wells do not increase biological n. Without a biological design, legacy well-level results remain explicit. Includes QC and NTC diagnostics.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["files"],
      properties: {
        runtime: batchRuntimeSchema,
        importOptions: pcrImportSchema,
        files: { type: "array", minItems: 1, items: { type: "string", minLength: 1 }, description: "数据文件路径；默认首表，可用 importOptions.sheet 显式选表 / Data files; first sheet by default, exact name selection optional" },
        refGenes: { type: "array", items: { type: "string", minLength: 1 }, description: "内参基因名，单个即可；多个可选 / One reference gene is sufficient" },
        controlSamples: { type: "array", items: { type: "string", minLength: 1 }, description: "对照样本名（Sample 列中的名字）" },
        qc: { type: "object", additionalProperties: false, properties: {
          minCq: { type: "number", minimum: 0 }, maxCq: { type: "number", minimum: 0 },
          absDev: { type: "number", exclusiveMinimum: 0 }, zScore: { type: "number", exclusiveMinimum: 0 },
          repSD: { type: "number", exclusiveMinimum: 0 },
        }, description: "Optional QC thresholds; repSD reports groups only / 可选质控阈值，repSD仅报告组" },
        qcMode: { type: "string", enum: ["report", "exclude"], description: "Default report; exclude explicitly removes flagged non-NTC wells / 默认只报告" },
        excludeRows: { type: "array", items: { type: "integer", minimum: 1 }, description: "Explicit row IDs from qcReport, applied to each input file / 按报告行ID显式排除" },
        biologicalDesign: { type: "object", additionalProperties: false, required: ["samples", "controlGroup"], properties: {
          samples: { type: "object", additionalProperties: { type: "string", minLength: 1 } },
          controlGroup: { type: "string", minLength: 1 },
          paired: { type: "boolean", description: "Explicit paired design, requires pairIds / 配对设计须提供pairIds" },
          pairIds: { type: "object", additionalProperties: { type: "string", minLength: 1 }, description: "Complete sample-to-pair-ID mapping / 完整样本名到配对ID映射" },
        }, description: "Explicit biological sample groups; paired is false by default / 显式生物学样本分组，默认非配对" },
        efficiencies: { type: "object", additionalProperties: { type: "number", exclusiveMinimum: 0 }, description: "每基因扩增效率百分比，如 {\"LDHA\":92}；覆盖 RDML 声明效率，无效率信息时用 100（Livak）" },
      },
    },
    call: (a) => engine.runPcr({
      runtime: a.runtime, files: a.files ?? [], refGenes: a.refGenes ?? [], controlSamples: a.controlSamples ?? [],
      biologicalDesign: a.biologicalDesign ?? null, importOptions: a.importOptions ?? {},
      efficiencies: a.efficiencies ?? {}, qc: a.qc ?? {}, qcMode: a.qcMode ?? "report", excludeRows: a.excludeRows ?? [],
    }),
  },
  {
    name: "pcr_preview",
    description: "Parse qPCR data without expression inference or QC exclusion. Inspect worksheet names, selected sheet, exact header/column mapping, physical source rows, parsed values and issues before analysis. No reference gene, control or biological design is required / 仅解析预览，检查数据来源和列映射，不做定量推断。",
    inputSchema: {type:"object",additionalProperties:false,required:["files"],properties:{
      runtime:batchRuntimeSchema,
      files:{type:"array",minItems:1,items:{type:"string",minLength:1}},
      importOptions:pcrImportSchema,
    }},
    call: a => engine.previewPcr({files:a.files,importOptions:a.importOptions??{},runtime:a.runtime}),
  },
  {
    name: "pcr_verify",
    description:
      "Run the independent-reference verification for the pcr engine (4 scenarios: Livak/Pfaffl/Welch/ANOVA/Dunnett vs a from-scratch Python implementation on real QuantStudio data). Pass line: ΔΔCt/Pfaffl ≤1e-09, Welch/ANOVA ≤1e-08, deep-tail Dunnett inside [raw p, k·raw p].",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { runtime: batchRuntimeSchema, dir: { type: "string", minLength: 1, description: "验证材料目录（默认 ~/Downloads/WispLab预印本验证/pcr）" } },
    },
    call: (a) => engine.runVerifyPcr(a.dir, a.runtime),
  },
];

}

function textResult(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

/** Build an isolated dispatcher. Engine injection keeps protocol tests independent of analysis dependencies. */
export function createMcpHandler({ cfg, engine = lib, notify = () => {} }) {
  if (engine === lib) engine = {
    runWb: ({ runtime, ...args }) => runAnalysisJob("wb", args, cfg, runtime),
    runPcr: ({ runtime, ...args }) => runAnalysisJob("pcr", args, cfg, runtime),
    previewPcr: ({ runtime, ...args }) => runAnalysisJob("pcr-preview", args, cfg, runtime),
    runIhc: args => lib.runIhc(args, cfg),
    runVerifyPcr: (dir, runtime) => runAnalysisJob("verify-pcr", { dir }, cfg, runtime),
  };
  const active = new Map();
  let queue = Promise.resolve();
  const configuredRoots = cfg.allowPaths ?? [join(homedir(), "Downloads"), "/tmp"];
  if (!Array.isArray(configuredRoots) || configuredRoots.some((path) => typeof path !== "string" || !path.trim()))
    throw new Error("allowPaths must be an array of non-empty paths");
  const roots = configuredRoots.map(expandPath).filter(existsSync).map((path) => {
    if (!statSync(path).isDirectory()) throw new Error(`allowPaths requires directories: ${path}`);
    return realpathSync(path);
  });
  const tools = toolsFor(engine);
  let legacyVersion = null;

  async function dispatch(tool, args, runtime) {
    validate(args, tool.inputSchema);
    const input = { ...args };
    if (tool.name === "pcr_analyze" || tool.name === "pcr_preview") input.importOptions = normalizePcrImportOptions(input.importOptions);
    if (tool.name === "pcr_analyze" && input.biologicalDesign !== undefined) input.biologicalDesign = normalizeBiologicalDesign(input.biologicalDesign);
    if (tool.name === "pcr_verify") {
      input.dir = checkedPath(input.dir ?? join(homedir(), "Downloads", "WispLab预印本验证", "pcr"), roots, "directory");
      for (const script of ["dump_app.ts", "reference_check.py"]) checkedPath(join(input.dir, script), roots);
    } else {
      input.files = input.files.map((path) => checkedPath(path, roots));
      if (input.controlTif !== undefined) input.controlTif = checkedPath(input.controlTif, roots);
      if (input.reviewDir !== undefined) input.reviewDir = checkedPath(input.reviewDir, roots, "directory");
    }
    input.runtime = { ...input.runtime, ...runtime };
    return await tool.call(input);
  }

  const handleMessage = async function (message) {
    let msg;
    try { msg = typeof message === "string" ? JSON.parse(message) : message; }
    catch { return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }; }
    const error = (code, message, data) => ({
      jsonrpc: "2.0", id: typeof msg?.id === "string" || Number.isInteger(msg?.id) ? msg.id : null,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    });
    if (!isObject(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string")
      return error(-32600, "Invalid Request");
    if (!Object.hasOwn(msg, "id")) {
      if (msg.method === "notifications/cancelled") {
        const requestId = msg.params?.requestId;
        if ((typeof requestId === "string" || Number.isInteger(requestId)) &&
            (msg.params.reason === undefined || typeof msg.params.reason === "string")) active.get(requestId)?.abort();
      }
      return null;
    }
    if (typeof msg.id !== "string" && !Number.isInteger(msg.id)) return error(-32600, "Invalid request ID");
    if (msg.params !== undefined && !isObject(msg.params)) return error(-32602, "params must be an object");
    const params = msg.params ?? {};
    const metadata = params._meta;
    if (metadata !== undefined && !isObject(metadata)) return error(-32602, "_meta must be an object");
    const requested = metadata?.[`${META}protocolVersion`];
    const modern = requested !== undefined || Object.hasOwn(metadata ?? {}, `${META}clientCapabilities`) || msg.method === "server/discover";
    const respond = (result) => ({ jsonrpc: "2.0", id: msg.id, result: modern ? {
      ...result, resultType: "complete", _meta: { [`${META}serverInfo`]: SERVER_INFO },
    } : result });

    if (modern) {
      if (typeof requested !== "string") return error(-32602, "Missing required _meta protocolVersion");
      if (requested !== MODERN_VERSION) return error(-32022, "Unsupported protocol version", {
        supported: SUPPORTED_VERSIONS, requested,
      });
      if (!isObject(metadata[`${META}clientCapabilities`]))
        return error(-32602, "Missing required _meta clientCapabilities");
      if (msg.method === "initialize") return error(-32601, "Modern clients use server/discover instead of initialize");
    } else if (msg.method !== "initialize" && msg.method !== "ping" && !legacyVersion) {
      return error(-32600, "Initialize first or send modern per-request metadata");
    }

    try {
      switch (msg.method) {
        case "initialize": {
          if (typeof params.protocolVersion !== "string" || !isObject(params.capabilities) || !isObject(params.clientInfo))
            return error(-32602, "initialize requires protocolVersion, capabilities and clientInfo");
          legacyVersion = LEGACY_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : LEGACY_VERSIONS[0];
          return respond({ protocolVersion: legacyVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
        }
        case "server/discover":
          return respond({ supportedVersions: SUPPORTED_VERSIONS, capabilities: { tools: {} } });
        case "ping":
          return respond({});
        case "tools/list":
          return respond({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        case "tools/call": {
          if (typeof params.name !== "string") return error(-32602, "Tool name must be a string");
          if (params.arguments !== undefined && !isObject(params.arguments))
            return error(-32602, "Tool arguments must be an object");
          const tool = tools.find((candidate) => candidate.name === params.name);
          if (!tool) return error(-32602, `Unknown tool: ${params.name}`);
          if (active.has(msg.id)) return error(-32600, "Request ID already active");
          const controller = new AbortController();
          active.set(msg.id, controller);
          const progressToken = metadata?.progressToken;
          let progress = -Infinity;
          const runtime = { signal: controller.signal, onProgress: event => {
            if (controller.signal.aborted || !(typeof progressToken === "string" || Number.isInteger(progressToken))) return;
            if (!Number.isFinite(event.progress) || event.progress <= progress) return;
            progress = event.progress;
            notify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken, ...event } });
          } };
          try {
            const pending = queue.then(() => {
              if (controller.signal.aborted) throw new Error("Analysis cancelled");
              return dispatch(tool, params.arguments ?? {}, runtime);
            });
            queue = pending.catch(() => {});
            const result = await pending;
            if (controller.signal.aborted) return null;
            const fileErrors = [...(Array.isArray(result?.files) ? result.files : []), ...(Array.isArray(result?.images) ? result.images : [])]
              .some((item) => item?.error !== undefined);
            return respond({ ...textResult(result), isError: Boolean(result?.error) || fileErrors || Boolean(result?.review?.error) || (tool.name === "pcr_verify" && result.exitCode !== 0) });
          } catch (err) {
            if (controller.signal.aborted) return null;
            return respond({ ...textResult(err.provenance ? {error: err.message, provenance: err.provenance} : `wisplab tool error / 工具错误：${err.message}`), isError: true });
          } finally {
            active.delete(msg.id);
          }
        }
        default:
          return error(-32601, `Method not found: ${msg.method}`);
      }
    } catch (err) {
      return error(-32603, err.message);
    }
  };
  handleMessage.cancelAll = () => { for (const controller of active.values()) controller.abort(); };
  return handleMessage;
}

export async function startServer() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--config" || args[1].startsWith("--")))
    throw new Error("Usage: node mcp-server.mjs [--config path]");
  const cfg = lib.config(args[1]);
  const write = message => process.stdout.write(`${JSON.stringify(message)}\n`);
  const handle = createMcpHandler({ cfg, notify: write });
  const pending = new Set();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const stop = () => { handle.cancelAll(); input.close(); process.stdin.pause(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdout.on("error", stop);
  // Analysis is serialized by the handler, while ping/cancel continue to be read.
  // EOF drains outstanding work; it is not a cancellation request.
  for await (const line of input) {
    if (!line.trim()) continue;
    const task = handle(line).then(response => { if (response) write(response); });
    pending.add(task);
    task.finally(() => pending.delete(task));
  }
  await Promise.all(pending);
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  process.stdout.removeListener("error", stop);
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  startServer().catch((error) => {
    console.error(`wisplab MCP: ${error.message}`);
    process.exitCode = 1;
  });
}
