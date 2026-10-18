/** wisplab 共享逻辑：配置解析 + 三引擎 runner 调度（cli.mjs 与 mcp-server.mjs 共用）。 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CLI_DIR = dirname(fileURLToPath(import.meta.url));

export function loadConfig(configPath) {
  const candidates = [
    configPath,
    process.env.WISPLAB_CONFIG,
    join(process.cwd(), "wisplab.config.json"),
    join(CLI_DIR, "wisplab.config.json"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return { path: resolve(c), ...JSON.parse(readFileSync(c, "utf8")) };
  }
  throw new Error(`wisplab.config.json 未找到（候选：${candidates.join(", ")}）`);
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
    .replaceAll("<WB>", repoPath)
    .replaceAll("<PCR>", repoPath);
  const tmpDir = join(CLI_DIR, ".run");
  mkdirSync(tmpDir, { recursive: true });
  const runnerPath = join(tmpDir, `${repoPath.split("/").pop()}-${runner}`);
  writeFileSync(runnerPath, src);
  const r = spawnSync(tsxBin(repoPath), [runnerPath, JSON.stringify(payload)], {
    cwd: repoPath, encoding: "utf8", timeout: timeoutMs,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`runner 失败：${(r.stderr || r.stdout || "").slice(-600)}`);
  const line = (r.stdout || "").split("\n").filter((l) => l.startsWith("@@WISPLAB@@")).pop();
  if (!line) throw new Error(`runner 无输出：${(r.stderr || "").slice(-400)}`);
  return JSON.parse(line.slice("@@WISPLAB@@".length));
}

export function runWb({ files, lanes = null, strip = null, bg = "local", radius = 50, signal = "dark", controlLane = 1 }) {
  return runRunner(repo("wb"), "wb-run.ts", {
    files: files.map((f) => resolve(f)),
    lanes, strip,
    bg: bg === "rolling" ? { kind: "rolling-ball", radius: Number(radius) } : { kind: "local" },
    signal, controlLane: Number(controlLane),
  });
}

export function runPcr({ files, refGenes = [], controlSamples = [], efficiencies = {} }) {
  return runRunner(repo("pcr"), "pcr-run.ts", {
    files: files.map((f) => resolve(f)),
    refGenes, controlSamples, efficiencies,
  });
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
  const repoPath = repo("ihc");
  const require = createRequire(join(repoPath, "package.json"));
  const { chromium } = require("playwright");
  const port = config().ihc?.devPort ?? 5173;
  const app = `http://localhost:${port}`;
  const viteBin = join(repoPath, "node_modules", ".bin", "vite");
  if (!existsSync(viteBin)) throw new Error(`${repoPath} 缺少 node_modules/.bin/vite（先 npm install）`);
  const vite = spawn(viteBin, ["--port", String(port), "--strictPort"], { cwd: repoPath, stdio: "ignore" });
  let browser;
  try {
    let up = false;
    for (let i = 0; i < 30 && !up; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      try { up = (await fetch(app)).ok; } catch { up = false; }
    }
    if (!up) throw new Error("vite dev 未能在 15 秒内启动");
    browser = await chromium.launch({ args: ["--no-proxy-server"] });
    const page = await browser.newPage();
    await page.goto(app, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    let controlThreshold = null;
    let controlName = null;
    if (controlTif) {
      controlName = String(controlTif).split("/").pop();
      controlThreshold = await page.evaluate(async ({ b64, name }) => {
        const { decodeImageFile } = await import("/src/core/image/decode.ts");
        const { controlThresholdFromChannel } = await import("/src/core/analysis/calibrate.ts");
        const { buildStainMatrix, extractStainChannel } = await import("/src/core/image/color.ts");
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        const dec = await decodeImageFile(new File([bytes], name, { type: "image/tiff" }));
        const matrix = buildStainMatrix([0.684, 0.696, 0.183], [0.25, 0.5, 0.85]);
        return controlThresholdFromChannel(extractStainChannel(dec.pixels, matrix, 1), 0.001);
      }, { b64: readFileSync(controlTif).toString("base64"), name: controlName });
    }

    const out = [];
    for (const path of files) {
      const name = String(path).split("/").pop();
      const b64 = readFileSync(path).toString("base64");
      const res = await page.evaluate(async ({ b64, name, coloc, profile, controlThreshold }) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        const { decodeImageFile } = await import("/src/core/image/decode.ts");
        const { analyzeStainImage, analyzeColocImage } = await import("/src/core/analysis/engine.ts");
        const { DEFAULT_THRESHOLD, DEFAULT_SEGMENTATION, DEFAULT_COLOC } = await import("/src/core/types.ts");
        const dec = await decodeImageFile(new File([bytes], name, { type: "image/jpeg" }));
        const pixels = dec.pixels;
        if (coloc) {
          const r = analyzeColocImage(pixels, JSON.parse(JSON.stringify(DEFAULT_COLOC)));
          return { coloc: r.coloc, overall: r.overall, warnings: r.warnings, width: pixels.width, height: pixels.height };
        }
        const threshold = controlThreshold !== null && controlThreshold !== undefined
          ? { ...JSON.parse(JSON.stringify(DEFAULT_THRESHOLD)), mode: "control", controlThreshold, controlImageName: name }
          : JSON.parse(JSON.stringify(DEFAULT_THRESHOLD));
        const r = analyzeStainImage({
          pixels, rois: [], profileId: profile, threshold,
          segmentation: JSON.parse(JSON.stringify(DEFAULT_SEGMENTATION)),
          calibration: { mpp: null }, stainOverride: null,
        });
        return {
          overall: r.overall, thresholdUsed: r.thresholdUsed, backgroundLevel: r.backgroundLevel,
          warnings: r.warnings, qc: r.qc, width: pixels.width, height: pixels.height,
        };
      }, { b64, name, coloc, profile, controlThreshold });
      out.push({ file: name, ...res });
    }
    return { files: out, coloc, profile: coloc ? "if_coloc" : profile, controlThreshold };
  } finally {
    if (browser) await browser.close().catch(() => {});
    vite.kill();
  }
}
