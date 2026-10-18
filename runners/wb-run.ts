/**
 * wisplab wb runner：由 blot-workbench 仓库的 tsx 执行。
 * argv[2] = JSON {files:[路径], lanes?, strip?:"y,h,x0,x1", bg:{kind, radius?}, signal, controlLane}
 * 每张图：decode → 条带（可选）内 proposeRegions → 全图 rolling-ball/local 测量 → 以泳道1为对照的比值。
 * 结果以 @@WISPLAB@@{json} 单行输出到 stdout。
 */
import { readFileSync } from "node:fs";
import { decodeRaster, proposeRegions, measureRegion } from "<WB>/src/real/pixels.ts";
import { cachedRollingBallBackground, measureRegionRollingBall } from "<WB>/src/real/rolling-ball.ts";

const payload = JSON.parse(process.argv[2]);
const signal = payload.signal === "light" ? "light" : "dark";
const images = [];

for (const path of payload.files) {
  const name = path.split("/").pop() ?? path;
  const raster = decodeRaster(new Uint8Array(readFileSync(path)), name);
  const strip = parseStrip(payload.strip, raster);
  const source = strip ?? raster;
  let regions = null;
  let laneCount = payload.lanes ?? null;
  let lastError = "";
  if (laneCount) {
    try { regions = proposeRegions(source, laneCount, signal); } catch (e) { lastError = String(e.message ?? e); regions = null; }
  } else {
    for (const n of [6, 7, 5, 8, 4, 3]) {
      try {
        const r = proposeRegions(source, n, signal);
        if (r.length >= 2) { regions = r; laneCount = n; break; }
      } catch (e) { lastError = String(e.message ?? e); }
    }
  }
  if (!regions || regions.length === 0) {
    images.push({ file: name, width: raster.width, height: raster.height, bitDepth: raster.bitDepth, error: `泳道提议失败（需人工 ROI）：${lastError}` });
    continue;
  }
  const mapped = strip
    ? regions.map((r) => ({ ...r, source: "manual", band: { ...r.band, x: r.band.x + strip.x0, y: r.band.y + strip.y }, background: { ...r.background, x: r.background.x + strip.x0, y: r.background.y + strip.y } }))
    : regions;
  const measure = (region) =>
    payload.bg.kind === "rolling-ball"
      ? measureRegionRollingBall(raster, region, signal, cachedRollingBallBackground(raster, payload.bg.radius, signal))
      : measureRegion(raster, region, signal);
  const lanes = mapped.map((region) => {
    const m = measure(region);
    return {
      lane: region.lane, band: region.band, background: region.background,
      bandSum: m.bandSum, backgroundMean: m.backgroundMean, net: m.net, warnings: m.warnings,
    };
  });
  const control = lanes.find((l) => l.lane === payload.controlLane) ?? lanes[0];
  for (const l of lanes) {
    l.ratio = control && control.net > 0 ? +(l.net / control.net).toFixed(6) : null;
  }
  images.push({
    file: name, width: raster.width, height: raster.height, bitDepth: raster.bitDepth,
    laneCount: lanes.length, backgroundMethod: payload.bg.kind,
    rollingBallRadius: payload.bg.kind === "rolling-ball" ? payload.bg.radius : null,
    signal, lanes,
  });
}

function parseStrip(spec, raster) {
  if (!spec) return null;
  const [y, h, x0, x1] = String(spec).split(",").map(Number);
  const sy = Math.max(0, y | 0);
  const sh = Math.min(h | 0, raster.height - sy);
  const sx = Math.max(0, x0 | 0);
  const sw = Math.min(x1 | 0 || raster.width, raster.width) - sx;
  const pixels = new Float64Array(sw * sh);
  for (let row = 0; row < sh; row += 1)
    pixels.set(raster.pixels.subarray((sy + row) * raster.width + sx, (sy + row) * raster.width + sx + sw), row * sw);
  return { ...raster, width: sw, height: sh, pixels, y: sy, x0: sx };
}

console.log("@@WISPLAB@@" + JSON.stringify({ signal, backgroundMethod: payload.bg.kind, images }));
