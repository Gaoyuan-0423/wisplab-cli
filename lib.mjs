/** wisplab 共享逻辑：配置解析 + 三引擎 runner 调度（cli.mjs 与 mcp-server.mjs 共用）。 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import { trackAnalysisSync, trackAnalysis } from "./provenance.mjs";
import { normalizeBiologicalDesign } from "./pcr-groups.mjs";
import { normalizePcrOptions } from "./pcr-options.mjs";

export const CLI_DIR = dirname(fileURLToPath(import.meta.url));

export function expandPath(value, base = process.cwd()) {
  if (typeof value !== "string" || !value.trim()) throw new Error("路径必须是非空字符串 / Path must be a nonempty string");
  return resolve(base, value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value);
}

export function loadConfig(configPath) {
  const explicit = configPath ?? process.env.WISPLAB_CONFIG;
  const candidates = explicit !== undefined ? [expandPath(explicit)] : [join(process.cwd(), "wisplab.config.json"), join(CLI_DIR, "wisplab.config.json")];
  const path = candidates.find(existsSync);
  if (!path) throw new Error(`wisplab.config.json 未找到 / Config not found: ${candidates.join(", ")}`);
  const cfg = JSON.parse(readFileSync(path, "utf8"));
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error("配置必须是 JSON 对象 / Config must be an object");
  const base = dirname(path);
  const repos = Object.fromEntries(Object.entries(cfg.repos ?? {}).map(([key, value]) => [key, expandPath(value, base)]));
  const allowPaths = (cfg.allowPaths ?? [join(homedir(), "Downloads"), tmpdir(), "/tmp"]).map((value) => expandPath(value, base));
  const devPort = cfg.ihc?.devPort ?? 5173;
  if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535) throw new Error("ihc.devPort 必须是 1–65535 的整数 / Invalid port");
  return { ...cfg, path, repos, allowPaths, ihc: { ...cfg.ihc, devPort } };
}

let cachedCfg = null;
export function config(overridePath) {
  if (!cachedCfg || overridePath) cachedCfg = loadConfig(overridePath);
  return cachedCfg;
}

export function repo(name, overridePath) {
  const p = overridePath ?? config().repos?.[name];
  if (!p || !existsSync(p)) throw new Error(`config 中 repos.${name} 无效：${p}`);
  return p;
}
function tsxBin(repoPath) {
  const bin = join(repoPath, "node_modules", ".bin", "tsx");
  if (!existsSync(bin)) throw new Error(`${repoPath} 缺少 node_modules/.bin/tsx（先 npm install）`);
  return bin;
}
function runRunner(repoPath, runner, payload, timeoutMs = 300_000) {
  const src = readFileSync(join(CLI_DIR, "runners", runner), "utf8")
    .replaceAll("<WB>", pathToFileURL(repoPath).href)
    .replaceAll("<PCR>", pathToFileURL(repoPath).href)
    .replaceAll("<CLI>", pathToFileURL(CLI_DIR).href);
  const tmpDir = mkdtempSync(join(tmpdir(), "wisplab-run-"));
  const runnerPath = join(tmpDir, runner);
  try {
    writeFileSync(join(tmpDir, "package.json"), '{"type":"module"}\n');
    writeFileSync(runnerPath, src);
    const r = spawnSync(tsxBin(repoPath), [runnerPath, JSON.stringify(payload)], {
      cwd: repoPath, encoding: "utf8", timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024,
    });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`runner 失败：${(r.stderr || r.stdout || "").slice(-600)}`);
    const line = (r.stdout || "").split("\n").filter((l) => l.startsWith("@@WISPLAB@@")).pop();
    if (!line) throw new Error(`runner 无输出：${(r.stderr || "").slice(-400)}`);
    return JSON.parse(line.slice("@@WISPLAB@@".length));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function validateFiles(files) {
  if (!Array.isArray(files) || !files.length || files.some((f) => typeof f !== "string" || !f.trim())) throw new Error("至少一个文件路径 / At least one file path is required");
}
function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} 必须是正整数 / must be a positive integer`);
}

export function runWb({ files, lanes = null, strip = null, bg = "local", radius = 50, signal = "dark", controlLane = 1 }) {
  validateFiles(files);
  if (lanes !== null) positiveInteger(lanes, "lanes");
  positiveInteger(radius, "radius");
  positiveInteger(controlLane, "controlLane");
  if (lanes !== null && controlLane > lanes) throw new Error("controlLane 超出泳道数 / exceeds lane count");
  if (!["local", "rolling"].includes(bg)) throw new Error("bg: local | rolling");
  if (!["dark", "light"].includes(signal)) throw new Error("signal: dark | light");
  if (strip !== null && (typeof strip !== "string" || strip.split(",").length !== 4 || strip.split(",").some((v) => !v.trim() || !Number.isInteger(Number(v))))) throw new Error("strip: y,h,x0,x1 (integer pixels)");
  const parameters = { lanes, strip, bg, radius, signal, controlLane };
  const engineDir = repo("wb");
  return trackAnalysisSync({ analysis: "wb", engineDir, bridgeDir: CLI_DIR, parameters, inputs: files.map(path => ({path})) },
    () => runRunner(engineDir, "wb-run.ts", {
      files: files.map(f => resolve(f)), lanes, strip,
      bg: bg === "rolling" ? {kind: "rolling-ball", radius} : {kind: "local"}, signal, controlLane,
    }));
}

export function runPcr({ files, refGenes = [], controlSamples = [], efficiencies = {}, qc = {}, qcMode = "report", excludeRows = [], biologicalDesign = null }) {
  validateFiles(files);
  for (const [name, values] of Object.entries({ refGenes, controlSamples })) {
    if (!Array.isArray(values) || values.some((v) => typeof v !== "string" || !v.trim())) throw new Error(`${name}: expected nonempty gene/sample names`);
  }
  if (!efficiencies || typeof efficiencies !== "object" || Array.isArray(efficiencies)) throw new Error("efficiencies: expected an object");
  for (const [gene, value] of Object.entries(efficiencies)) {
    if (!gene.trim() || !Number.isFinite(value) || value <= 0 || value > 200) throw new Error("efficiencies: percentages must be > 0 and <= 200");
  }
  if (excludeRows.length && files.length !== 1) throw new Error("Manual row exclusion requires exactly one input file");
  biologicalDesign = normalizeBiologicalDesign(biologicalDesign);
  if (biologicalDesign) {
    if (files.length !== 1) throw new Error("Biological design requires exactly one input file");
    const controls = Object.keys(biologicalDesign.samples).filter(s => biologicalDesign.samples[s] === biologicalDesign.controlGroup);
    if (controlSamples.length && JSON.stringify([...new Set(controlSamples)].sort()) !== JSON.stringify([...controls].sort()))
      throw new Error("controlSamples conflicts with biological controlGroup");
    controlSamples = controls;
  }
  const parameters = { refGenes, controlSamples, efficiencies, biologicalDesign, ...normalizePcrOptions({ qc, qcMode, excludeRows }) };
  const engineDir = repo("pcr");
  return trackAnalysisSync({ analysis: "pcr", engineDir, bridgeDir: CLI_DIR, parameters, inputs: files.map(path => ({path})) },
    () => runRunner(engineDir, "pcr-run.ts", { files: files.map(f => resolve(f)), ...parameters }));
}

export function runVerifyPcr(dir) {
  const target = resolve(dir ?? join(process.env.HOME ?? "", "Downloads", "WispLab预印本验证", "pcr"));
  if (!existsSync(join(target, "dump_app.ts")) || !existsSync(join(target, "reference_check.py")))
    throw new Error(`verify 材料目录不存在或不完整：${target}（dump_app.ts + reference_check.py 需同时在场；材料随验证记录分发）`);
  const repoPath = repo("pcr");
  const d = spawnSync(tsxBin(repoPath), [join(target, "dump_app.ts")], { cwd: repoPath, encoding: "utf8", timeout: 300_000 });
  if (d.status !== 0) throw new Error(`dump 失败：${(d.stderr || d.stdout || "").slice(-400)}`);
  const c = spawnSync("python3", [join(target, "reference_check.py")], { encoding: "utf8", timeout: 600_000 });
  return { exitCode: c.status ?? 1, output: (c.stdout || "") + (c.stderr || "") };
}

export async function runIhc({ files, coloc = false, profile = "h_dab", controlTif = null }) {
  validateFiles(files);
  if (!["h_dab", "h_eosin", "masson", "if_coloc"].includes(profile)) throw new Error("Unsupported stain profile");
  if (controlTif && (coloc || profile !== "h_dab")) throw new Error("对照片标定仅支持 H-DAB / Control calibration supports H-DAB only");
  const parameters = { coloc, profile: coloc ? "if_coloc" : profile, controlTif: controlTif ? "input-with-role-control" : null, devPort: config().ihc.devPort };
  const inputs = files.map(path => ({path}));
  if (controlTif) inputs.push({path: controlTif, role: "control"});
  return trackAnalysis({ analysis: coloc ? "if" : "ihc", engineDir: repo("ihc"), bridgeDir: CLI_DIR, parameters, inputs },
    () => runIhcEngine({files, coloc, profile, controlTif}));
}

async function runIhcEngine({ files, coloc, profile, controlTif }) {
  validateFiles(files);
  if (!["h_dab", "h_eosin", "masson", "if_coloc"].includes(profile)) throw new Error("Unsupported stain profile");
  if (controlTif && (coloc || profile !== "h_dab")) throw new Error("对照片标定仅支持 H-DAB / Control calibration supports H-DAB only");
  const repoPath = repo("ihc");
  const require = createRequire(join(repoPath, "package.json"));
  const { chromium } = require("playwright");
  const port = config().ihc?.devPort ?? 5173;
  const app = `http://127.0.0.1:${port}`;
  const viteBin = join(repoPath, "node_modules", ".bin", "vite");
  if (!existsSync(viteBin)) throw new Error(`${repoPath} 缺少 node_modules/.bin/vite（先 npm install）`);
  const vite = spawn(viteBin, ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: repoPath, stdio: ["ignore", "pipe", "pipe"] });
  let startupError;
  let startupLog = "";
  let serverReady = false;
  const capture = (chunk) => {
    startupLog = (startupLog + chunk.toString()).slice(-4000);
    // Vite prints its own listening URL only after --strictPort has succeeded.
    serverReady ||= startupLog.replace(/\x1b\[[0-9;]*m/g, "").includes(app);
  };
  vite.stdout.on("data", capture);
  vite.stderr.on("data", capture);
  vite.on("error", (error) => { startupError = error; });
  vite.on("exit", (code, signal) => { startupError ??= new Error(`Vite exited before/during analysis (${code ?? signal}); check ihc.devPort: ${startupLog.slice(-600)}`); });
  let browser;
  try {
    let up = false;
    for (let i = 0; i < 30 && !up; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      if (startupError) throw startupError;
      if (!serverReady) continue;
      try { up = (await fetch(app, { signal: AbortSignal.timeout(1000) })).ok; } catch { up = false; }
    }
    if (startupError) throw startupError;
    if (!up) throw new Error("vite dev 未能在 15 秒内启动");
    browser = await chromium.launch({ args: ["--no-proxy-server"] });
    const page = await browser.newPage();
    await page.goto(app, { waitUntil: "domcontentloaded" });
    if (startupError) throw startupError;

    let controlThreshold = null;
    let controlName = null;
    if (controlTif) {
      controlName = String(controlTif).split("/").pop();
      controlThreshold = await page.evaluate(async ({ b64, name }) => {
        const { decodeImageFile } = await import("/src/core/image/decode.ts");
        const { controlThresholdFromChannel } = await import("/src/core/analysis/calibrate.ts");
        const { extractDabChannel } = await import("/src/core/image/color.ts");
        const { histogram256, percentileFromHist } = await import("/src/core/analysis/threshold.ts");
        const { DEFAULT_THRESHOLD } = await import("/src/core/types.ts");
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        const dec = await decodeImageFile(new File([bytes], name, { type: /\.tiff?$/i.test(name) ? "image/tiff" : /\.png$/i.test(name) ? "image/png" : "image/jpeg" }));
        const dab = extractDabChannel(dec.pixels);
        const background = percentileFromHist(histogram256(dab), DEFAULT_THRESHOLD.backgroundPercentile);
        for (let i = 0; i < dab.length; i++) dab[i] = Math.max(0, dab[i] - background);
        return controlThresholdFromChannel(dab, DEFAULT_THRESHOLD.controlFalsePositiveRate);
      }, { b64: readFileSync(controlTif).toString("base64"), name: controlName });
    }

    const out = [];
    for (const path of files) {
      const name = String(path).split("/").pop();
      try {
        const b64 = readFileSync(path).toString("base64");
        const res = await page.evaluate(async ({ b64, name, coloc, profile, controlThreshold, controlName }) => {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
          const { decodeImageFile } = await import("/src/core/image/decode.ts");
          const { analyzeStainImage, analyzeColocImage } = await import("/src/core/analysis/engine.ts");
          const { DEFAULT_THRESHOLD, DEFAULT_SEGMENTATION, DEFAULT_COLOC } = await import("/src/core/types.ts");
          const dec = await decodeImageFile(new File([bytes], name, { type: /\.tiff?$/i.test(name) ? "image/tiff" : /\.png$/i.test(name) ? "image/png" : "image/jpeg" }));
          const pixels = dec.pixels;
          const source = { sourceWidth: dec.sourceWidth, sourceHeight: dec.sourceHeight, workingScale: dec.workingScale, sourceType: dec.sourceType, bitsPerSample: dec.bitsPerSample, note: dec.note ?? null };
          if (coloc) {
            const r = analyzeColocImage(pixels, JSON.parse(JSON.stringify(DEFAULT_COLOC)));
            return { ...source, settings: { coloc: DEFAULT_COLOC }, coloc: r.coloc, overall: r.overall, warnings: r.warnings, width: pixels.width, height: pixels.height };
          }
          const threshold = controlThreshold !== null && controlThreshold !== undefined
            ? { ...JSON.parse(JSON.stringify(DEFAULT_THRESHOLD)), mode: "control", controlThreshold, controlImageName: controlName }
            : JSON.parse(JSON.stringify(DEFAULT_THRESHOLD));
          const r = analyzeStainImage({
            pixels, rois: [], profileId: profile, threshold,
            segmentation: JSON.parse(JSON.stringify(DEFAULT_SEGMENTATION)),
            calibration: { mpp: null }, stainOverride: null,
          });
          return {
            ...source, settings: { profile, threshold, segmentation: DEFAULT_SEGMENTATION, calibration: { mpp: null } }, overall: r.overall, thresholdUsed: r.thresholdUsed, backgroundLevel: r.backgroundLevel,
            warnings: r.warnings, qc: r.qc, width: pixels.width, height: pixels.height,
          };
        }, { b64, name, coloc, profile, controlThreshold, controlName });
        out.push({ file: name, ...res });
      } catch (error) {
        out.push({ file: name, error: String(error?.message ?? error) });
      }
    }
    return { files: out, coloc, profile: coloc ? "if_coloc" : profile, controlThreshold, controlImageName: controlName };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (vite.pid && vite.exitCode === null && vite.signalCode === null && !vite.killed) {
      await new Promise((done) => {
        const timer = setTimeout(() => { vite.kill("SIGKILL"); }, 2000);
        vite.once("exit", () => { clearTimeout(timer); done(); });
        vite.kill();
      });
    }
  }
}


/** Local readiness and revision report; does not fetch or modify engine repositories. */
export function doctor() {
  const cfg = config();
  const requirements = {
    wb: ["node_modules/.bin/tsx", "src/real/pixels.ts", "src/real/rolling-ball.ts"],
    pcr: ["node_modules/.bin/tsx", "src/core/analysis.ts", "src/core/sniff.ts", "src/core/parse.ts", "src/core/qc.ts", "src/core/stats.ts"],
    ihc: ["node_modules/.bin/vite", "src/core/analysis/engine.ts", "src/core/image/decode.ts"],
  };
  const engines = Object.fromEntries(Object.entries(requirements).map(([name, files]) => {
    const path = cfg.repos[name];
    const missing = files.filter((file) => !path || !existsSync(join(path, file)));
    const git = (args) => path ? spawnSync("git", ["-C", path, ...args], { encoding: "utf8" }).stdout?.trim() || null : null;
    let browser = null;
    if (name === "ihc" && path) {
      try {
        const { chromium } = createRequire(join(path, "package.json"))("playwright");
        browser = chromium.executablePath();
        if (!existsSync(browser)) missing.push("Playwright Chromium (run npx playwright install chromium in pathology-workbench)");
      } catch { missing.push("playwright package"); }
    }
    return [name, { path: path ?? null, ready: missing.length === 0, missing, revision: git(["rev-parse", "HEAD"]), dirty: Boolean(git(["status", "--porcelain"])), ...(browser ? { browser } : {}) }];
  }));
  return { node: process.version, config: cfg.path, ready: Object.values(engines).every((e) => e.ready), engines };
}
