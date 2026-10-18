/**
 * wisplab ihc runner：Playwright 无头 + pathology-workbench vite dev。
 * 解码走 createImageBitmap（浏览器），引擎动态 import 自 /src/core/*。
 * 自动拉起并回收 vite dev；每图输出整图指标 JSON + 可选叠加图。
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runIhc({ files, coloc, profile, controlTif, repoPath, port }) {
  const require = createRequire(join(repoPath, "package.json"));
  const { chromium } = require("playwright");
  const app = `http://localhost:${port}`;

  // ── 拉起 vite dev ──
  const viteBin = join(repoPath, "node_modules", ".bin", "vite");
  if (!existsSync(viteBin)) throw new Error(`${repoPath} 缺少 node_modules/.bin/vite（先 npm install）`);
  const vite = spawn(viteBin, ["--port", String(port), "--strictPort"], { cwd: repoPath, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 30 && !up; i += 1) {
    await sleep(500);
    try {
      const r = await fetch(app);
      up = r.ok;
    } catch { up = false; }
  }
  if (!up) { vite.kill(); throw new Error("vite dev 未能在 15 秒内启动"); }

  const out = { files: [] };
  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-proxy-server"] });
    const page = await browser.newPage();
    await page.goto(app, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // 对照片标定（可选）：在页面内解码并计算阈值
    let controlThreshold = null;
    let controlName = null;
    if (controlTif) {
      controlName = controlTif.split("/").pop();
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

    for (const path of files) {
      const name = path.split("/").pop() ?? path;
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
        let payload;
        if (coloc) {
          const r = analyzeColocImage(pixels, JSON.parse(JSON.stringify(DEFAULT_COLOC)));
          payload = { coloc: r.coloc, overall: r.overall, warnings: r.warnings };
        } else {
          const threshold = controlThreshold !== null && controlThreshold !== undefined
            ? { ...JSON.parse(JSON.stringify(DEFAULT_THRESHOLD)), mode: "control", controlThreshold, controlImageName: "control" }
            : JSON.parse(JSON.stringify(DEFAULT_THRESHOLD));
          const r = analyzeStainImage({
            pixels, rois: [], profileId: profile,
            threshold, segmentation: JSON.parse(JSON.stringify(DEFAULT_SEGMENTATION)),
            calibration: { mpp: null }, stainOverride: null,
          });
          payload = {
            overall: r.overall,
            thresholdUsed: r.thresholdUsed,
            backgroundLevel: r.backgroundLevel,
            warnings: r.warnings,
            qc: r.qc,
          };
        }
        return { width: pixels.width, height: pixels.height, ...payload };
      }, { b64, name, coloc, profile, controlThreshold });
      out.files.push({ file: name, ...res });
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    vite.kill();
  }
  return out;
}
