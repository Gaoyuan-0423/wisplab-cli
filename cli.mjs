#!/usr/bin/env node
/** wisplab CLI — 参数解析 + 调 lib.mjs（与 mcp-server.mjs 共用同一份引擎调度）。 */
import { createHash } from "node:crypto";
import { compareNucleiReference } from "./ihc-nuclei-validation.mjs";
import { createAnnotationPack } from "./ihc-annotation-pack.mjs";
import { compareIhcReference } from "./ihc-validation.mjs";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAnalysisJob, normalizeRuntime } from "./runtime-controls.mjs";
import { runIhc, runVerifyPcr, config, doctor } from "./lib.mjs";

const CLI_DIR = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

const HELP = `wisplab — WispLab 三引擎无头定量（与 MCP server 共用同一调度）

  wisplab wb  <图...>  [--lanes N] [--strip y,h,x0,x1] [--bg local|rolling[:半径]]
                       [--signal dark|light] [--control 泳道号]
  wisplab ihc <图...>  [--profile h_dab|h_eosin|masson] [--control-tif 对照片]
                       [--roi-manifest rois.json] [--mpp 原图µm/px] [--nuclei] [--review-dir 已存在目录]
  wisplab ihc-validate <result.json> <reference.json>  离线参考值比较，无需引擎配置 / Offline reference comparison; no engine config
  wisplab ihc-annotation-pack <result.json> --images-root DIR --output-dir DIR
  wisplab ihc-nuclei-validate <result.json> <reference.json> --match-radius PX
  wisplab if  <图...> [--channels R,G] [--review-dir 已存在目录] IF 双通道共定位
  wisplab pcr <表...>  [--ref GAPDH] [--control C1,C2] [--eff "T=92;GAPDH=99"]
                       [--min-cq N] [--max-cq N] [--abs-dev N] [--z-score N] [--rep-sd N]
                       [--qc-mode report|exclude] [--exclude-rows 1,2]
                       [--groups '{"C1":"Control","T1":"Treatment"}' --control-group Control]
                       单个内参即可；多个内参可选 / One reference gene is sufficient; multiple are optional
  wisplab grade <模块> <提交.json>   AI 分析评分（模块：pcr|ihc|wb|synthetic16）
  wisplab verify-pcr [验证目录]
  wisplab doctor [--strict]      环境/引擎修订检查 / Check engine readiness
  wisplab --version

分析：--timeout-ms <ms> 整批时限，默认300000；IHC/IF --file-timeout-ms <ms> 单图时限，默认120000。
全局：--config <path> 指定仓库路径配置。`;

function emitAnalysis(result) {
  console.log(JSON.stringify(result, null, 2));
  if (result.error || result.review?.error || [...(result.files ?? []), ...(result.images ?? [])].some((item) => item.error)) process.exitCode = 1;
}

try {
  const valueFlags = new Set(["timeout-ms", "file-timeout-ms", "config", "lanes", "strip", "bg", "signal", "control", "control-tif", "profile", "ref", "eff", "min-cq", "max-cq", "abs-dev", "z-score", "rep-sd", "qc-mode", "exclude-rows", "groups", "control-group", "images-root", "output-dir", "match-radius", "roi-manifest", "channels", "mpp", "review-dir"]);
  const opts = {};
  const positional = [];
  let literal = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--" && !literal) { literal = true; continue; }
    if (!literal && a.startsWith("-")) {
      const flag = a === "-h" ? "help" : a.slice(2);
      if (["help", "version", "coloc", "strict", "nuclei"].includes(flag)) opts[flag] = true;
      else if (a.startsWith("--") && valueFlags.has(flag)) {
        const value = argv[++i];
        if (!value || value.startsWith("--")) throw new Error(`${a}: 缺少参数 / missing value`);
        opts[flag] = value;
      } else throw new Error(`未知选项 / Unknown option: ${a}`);
    } else positional.push(a);
  }
  const cmd = positional[0] ?? null;
  const files = positional.slice(1).map((f) => resolve(f));
  if (opts.version) {
    console.log(JSON.parse(readFileSync(join(CLI_DIR, "package.json"), "utf8")).version);
  } else if (!cmd || cmd === "-h" || cmd === "--help" || opts.help) {
    console.log(HELP);
  } else {
    const allowed = {
      wb: ["timeout-ms", "lanes", "strip", "bg", "signal", "control"],
      pcr: ["timeout-ms", "ref", "control", "eff", "min-cq", "max-cq", "abs-dev", "z-score", "rep-sd", "qc-mode", "exclude-rows", "groups", "control-group"], ihc: ["timeout-ms", "file-timeout-ms", "profile", "control-tif", "coloc", "roi-manifest", "channels", "mpp", "nuclei", "review-dir"], if: ["timeout-ms", "file-timeout-ms", "channels", "review-dir"],
      grade: [], "verify-pcr": [], doctor: ["strict"], "ihc-validate": [], "ihc-annotation-pack": ["images-root", "output-dir"], "ihc-nuclei-validate": ["match-radius"],
    };
    if (!allowed[cmd]) throw new Error(`未知命令 / Unknown command: ${cmd}`);
    for (const key of Object.keys(opts)) if (key !== "config" && !allowed[cmd].includes(key)) throw new Error(`--${key}: unsupported for ${cmd}`);
    if (!["ihc-validate", "ihc-annotation-pack", "ihc-nuclei-validate"].includes(cmd)) config(opts.config);
    const runtime = ["wb", "pcr", "ihc", "if"].includes(cmd) ? normalizeRuntime({
      ...(opts["timeout-ms"] !== undefined ? { timeoutMs: Number(opts["timeout-ms"]) } : {}),
      ...(opts["file-timeout-ms"] !== undefined ? { fileTimeoutMs: Number(opts["file-timeout-ms"]) } : {}),
      onProgress: ({ progress, total, message }) => console.error(`wisplab: ${progress}/${total ?? "?"} ${message}`),
    }) : null;
    const controller = new AbortController();
    if (runtime) {
      runtime.signal = controller.signal;
      process.once("SIGINT", () => controller.abort());
      process.once("SIGTERM", () => controller.abort());
    }
    if (cmd === "ihc-annotation-pack") {
      if(files.length !== 1) throw new Error("ihc-annotation-pack: expected result.json");
      console.log(JSON.stringify(createAnnotationPack(JSON.parse(readFileSync(files[0], "utf8")), {imagesRoot:opts["images-root"],outputDir:opts["output-dir"]}),null,2));
    } else if (cmd === "ihc-nuclei-validate") {
      if(files.length !== 2) throw new Error("ihc-nuclei-validate: expected result.json and reference.json");
      const bytes=files.map(path=>readFileSync(path));
      const report=compareNucleiReference(...bytes.map(data=>JSON.parse(data)), {radius:Number(opts["match-radius"])});
      report.documents=bytes.map((data,i)=>({role:i===0?"analysis-result":"nucleus-reference",sha256:createHash("sha256").update(data).digest("hex")}));
      console.log(JSON.stringify(report,null,2));
      if(report.status !== "compared") process.exitCode=1;
    } else if (cmd === "ihc-validate") {
      if (files.length !== 2) throw new Error("ihc-validate: expected result.json and reference.json");
      const bytes = files.map(path => readFileSync(path));
      const report = compareIhcReference(...bytes.map(data => JSON.parse(data)));
      report.documents = bytes.map((data,index) => ({role:index===0?"analysis-result":"reference",sha256:createHash("sha256").update(data).digest("hex")}));
      console.log(JSON.stringify(report,null,2));
      if (["incomplete","outside-tolerance"].includes(report.status)) process.exitCode=1;
    } else if (cmd === "doctor") {
      const result = doctor({ strict: Boolean(opts.strict) });
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = (opts.strict ? result.verified : result.ready) ? 0 : 1;
    } else if (cmd === "wb") {
      if (!files.length) throw new Error("wb：至少一个图像文件");
      const bg = String(opts.bg ?? "local");
      if (!/^(local|rolling(?::[1-9]\d*)?)$/.test(bg)) throw new Error("--bg: local | rolling[:radius]");
      emitAnalysis(await runAnalysisJob("wb", {
        files,
        lanes: opts.lanes ? Number(opts.lanes) : null,
        strip: typeof opts.strip === "string" ? opts.strip : null,
        bg: bg.startsWith("rolling") ? "rolling" : "local",
        radius: bg.startsWith("rolling") ? Number(bg.split(":")[1] ?? 50) : 50,
        signal: String(opts.signal ?? "dark"),
        controlLane: Number(opts.control ?? "1"),
      }, config(), runtime));
    } else if (cmd === "pcr") {
      if (!files.length) throw new Error("pcr：至少一个数据表");
      const eff = {};
      for (const kv of String(opts.eff ?? "").split(";").filter(Boolean)) {
        const parts = kv.split("=");
        if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) throw new Error("--eff: expected GENE=92;REF=99");
        eff[parts[0].trim()] = Number(parts[1]);
      }
      if (Boolean(opts.groups) !== Boolean(opts["control-group"])) throw new Error("--groups and --control-group must be supplied together");
      emitAnalysis(await runAnalysisJob("pcr", {
        biologicalDesign: opts.groups ? { samples: JSON.parse(opts.groups), controlGroup: opts["control-group"] } : null,
        files,
        refGenes: String(opts.ref ?? "").split(",").map((v) => v.trim()).filter(Boolean),
        controlSamples: String(opts.control ?? "").split(",").map((v) => v.trim()).filter(Boolean),
        efficiencies: eff,
        qc: Object.fromEntries(Object.entries({ minCq: "min-cq", maxCq: "max-cq", absDev: "abs-dev", zScore: "z-score", repSD: "rep-sd" })
          .filter(([, flag]) => opts[flag] !== undefined).map(([key, flag]) => [key, Number(opts[flag])])),
        qcMode: opts["qc-mode"] ?? "report",
        excludeRows: opts["exclude-rows"] === undefined ? [] : opts["exclude-rows"].split(",").map(Number),
      }, config(), runtime));
    } else if (cmd === "ihc" || cmd === "if") {
      if (!files.length) throw new Error(`${cmd}：至少一个图像文件`);
      const coloc = cmd === "if" || Boolean(opts.coloc);
      emitAnalysis(await runIhc({
        files,
        coloc, runtime,
        profile: coloc ? "if_coloc" : String(opts.profile ?? "h_dab"),
        controlTif: typeof opts["control-tif"] === "string" ? resolve(opts["control-tif"]) : null,
        roiManifest: opts["roi-manifest"] ? JSON.parse(readFileSync(resolve(opts["roi-manifest"]), "utf8")) : null,
        channels: opts.channels ? opts.channels.split(",").map(value => value.trim()) : null,
        mpp: opts.mpp === undefined ? null : Number(opts.mpp),
        includeNuclei: Boolean(opts.nuclei),
        reviewDir: opts["review-dir"] ? resolve(opts["review-dir"]) : null,
      }));
    } else if (cmd === "grade") {
      if (positional.length < 3) throw new Error("grade：用法 wisplab grade <pcr|ihc|wb|synthetic16> <submission.json>");
      const gradePath = join(CLI_DIR, "..", "wisplab-benchmark", "grade.mjs");
      const g = spawnSync(process.execPath, [gradePath, positional[1], positional[2]], { encoding: "utf8", stdio: "inherit" });
      process.exitCode = g.status ?? 1;
    } else if (cmd === "verify-pcr") {
      const r = runVerifyPcr(positional[1]);
      process.stdout.write(r.output);
      process.exitCode = r.exitCode;
    } else {
      console.log(HELP);
      process.exitCode = 1;
    }
  }
} catch (err) {
  if (err.provenance || ["CANCELLED", "BATCH_TIMEOUT", "FILE_TIMEOUT"].includes(err.code)) console.log(JSON.stringify({ error: err.message, ...(err.code ? {code:err.code} : {}), ...(err.provenance ? {provenance:err.provenance} : {}) }, null, 2));
  console.error(`wisplab: ${err.message}`);
  process.exitCode = 1;
}
