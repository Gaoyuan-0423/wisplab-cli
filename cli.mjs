#!/usr/bin/env node
/** wisplab CLI — 参数解析 + 调 lib.mjs（与 mcp-server.mjs 共用同一份引擎调度）。 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runWb, runPcr, runIhc, runVerifyPcr, loadConfig } from "./lib.mjs";

const CLI_DIR = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

function loadConfigCli() {
  const i = argv.indexOf("--config");
  loadConfig(i >= 0 ? argv[i + 1] : undefined);
}
loadConfigCli();

const VALUE_FLAGS = new Set(["--lanes", "--strip", "--bg", "--signal", "--control", "--control-tif", "--profile", "--ref", "--eff"]);
const opts = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--config") { i += 1; continue; }
  if (VALUE_FLAGS.has(a)) { opts[a.slice(2)] = argv[i + 1]; i += 1; continue; }
  if (a.startsWith("--")) { opts[a.slice(2)] = true; continue; }
  positional.push(a);
}
const cmd = positional[0] ?? null;
const files = positional.slice(1).map((f) => resolve(f));

const HELP = `wisplab — WispLab 三引擎无头定量（与 MCP server 共用同一调度）

  wisplab wb  <图...>  [--lanes N] [--strip y,h,x0,x1] [--bg local|rolling[:半径]]
                       [--signal dark|light] [--control 泳道号]
  wisplab ihc <图...>  [--profile h_dab|h_eosin|masson] [--control-tif 对照片]
  wisplab if  <图...>                                  IF 双通道共定位
  wisplab pcr <表...>  [--ref G1,G2] [--control C1,C2] [--eff "T=92;GAPDH=99"]
  wisplab grade <模块> <提交.json>   AI 分析评分（模块：pcr|ihc|wb|synthetic16）
  wisplab verify-pcr [验证目录]

全局：--config <path> 指定仓库路径配置。`;

try {
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(HELP);
  } else if (cmd === "wb") {
    if (!files.length) throw new Error("wb：至少一个图像文件");
    const bg = String(opts.bg ?? "local");
    console.log(JSON.stringify(runWb({
      files,
      lanes: opts.lanes ? Number(opts.lanes) : null,
      strip: typeof opts.strip === "string" ? opts.strip : null,
      bg: bg.startsWith("rolling") ? "rolling" : "local",
      radius: bg.startsWith("rolling") ? Number(bg.split(":")[1] ?? 50) : 50,
      signal: String(opts.signal ?? "dark"),
      controlLane: Number(opts.control ?? "1"),
    }), null, 2));
  } else if (cmd === "pcr") {
    if (!files.length) throw new Error("pcr：至少一个数据表");
    const eff = {};
    for (const kv of String(opts.eff ?? "").split(";").filter(Boolean)) {
      const [g, v] = kv.split("=");
      eff[g.trim()] = Number(v);
    }
    console.log(JSON.stringify(runPcr({
      files,
      refGenes: String(opts.ref ?? "").split(",").filter(Boolean),
      controlSamples: String(opts.control ?? "").split(",").filter(Boolean),
      efficiencies: eff,
    }), null, 2));
  } else if (cmd === "ihc" || cmd === "if") {
    if (!files.length) throw new Error(`${cmd}：至少一个图像文件`);
    const coloc = cmd === "if" || Boolean(opts.coloc);
    console.log(JSON.stringify(await runIhc({
      files,
      coloc,
      profile: coloc ? "if_coloc" : String(opts.profile ?? "h_dab"),
      controlTif: typeof opts["control-tif"] === "string" ? resolve(opts["control-tif"]) : null,
    }), null, 2));
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
} catch (err) {
  console.error(`wisplab: ${err.message}`);
  process.exitCode = 1;
}
