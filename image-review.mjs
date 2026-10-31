/** Local image review contracts. Source coordinates always refer to decoded original pixels. */
import { createHash } from 'node:crypto';
import { accessSync, constants, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export const roiManifestSchema = {
  type: 'object', additionalProperties: false, required: ['schemaVersion', 'images'], properties: {
    schemaVersion: { type: 'string', enum: ['wisplab.rois/v1'] },
    images: { type: 'array', minItems: 1, items: {
      type: 'object', additionalProperties: false,
      required: ['file', 'sha256', 'coordinateSpace', 'sourceWidth', 'sourceHeight', 'rois'], properties: {
        file: { type: 'string', minLength: 1 }, sha256: { type: 'string', minLength: 64 },
        coordinateSpace: { type: 'string', enum: ['source'] },
        sourceWidth: { type: 'integer', minimum: 1 }, sourceHeight: { type: 'integer', minimum: 1 },
        rois: { type: 'array', minItems: 1, items: {
          type: 'object', additionalProperties: false, required: ['id', 'name', 'x', 'y', 'w', 'h'], properties: {
            id: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 },
            x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 },
            w: { type: 'integer', minimum: 1 }, h: { type: 'integer', minimum: 1 },
          },
        } },
      },
    } },
  },
};
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed, label) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${label}: unexpected fields / 字段错误`);
}
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function normalizeImageOptions({ files, coloc = false, roiManifest = null, channels = null, mpp = null, includeNuclei = false, reviewDir = null }) {
  if (channels !== null && (!coloc || !Array.isArray(channels) || channels.length !== 2 || channels.some(c => !['R', 'G', 'B'].includes(c)) || channels[0] === channels[1]))
    throw new Error('channels: IF requires two distinct RGB channels / IF 需要两个不同的 RGB 通道');
  if (mpp !== null && (coloc || !Number.isFinite(mpp) || mpp <= 0 || !Number.isFinite(mpp * mpp) || mpp * mpp === 0)) throw new Error('mpp: IHC source pixel size and its square must be finite and > 0 / 原图像素尺寸及其平方必须为有限正数');
  if (typeof includeNuclei !== 'boolean' || (coloc && includeNuclei)) throw new Error('includeNuclei is an IHC boolean option / 核坐标仅支持 IHC');
  if (reviewDir !== null) {
    if (typeof reviewDir !== 'string' || !reviewDir.trim() || !statSync(reviewDir).isDirectory()) throw new Error('reviewDir: expected an existing directory / 需要已存在的目录');
    accessSync(reviewDir, constants.W_OK);
    reviewDir = resolve(reviewDir);
  }
  if (roiManifest !== null) {
    if (coloc) throw new Error('ROI import currently supports IHC only / ROI 导入目前仅支持 IHC');
    keys(roiManifest, ['schemaVersion', 'images'], 'roiManifest');
    if (roiManifest.schemaVersion !== 'wisplab.rois/v1' || !Array.isArray(roiManifest.images) || !roiManifest.images.length) throw new Error('Invalid ROI manifest schema / ROI 清单格式错误');
    const names = new Set();
    for (const entry of roiManifest.images) {
      keys(entry, ['file', 'sha256', 'coordinateSpace', 'sourceWidth', 'sourceHeight', 'rois'], 'ROI image');
      if (typeof entry.file !== 'string' || !entry.file.trim() || basename(entry.file) !== entry.file || entry.file.includes('\\') || names.has(entry.file)) throw new Error('ROI file: require unique basenames / 文件名必须唯一且不含路径');
      names.add(entry.file);
      if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('ROI sha256: expected 64 lowercase hexadecimal characters');
      if (entry.coordinateSpace !== 'source') throw new Error('ROI coordinateSpace must be source / ROI 必须使用原图坐标');
      if (![entry.sourceWidth, entry.sourceHeight].every(v => Number.isSafeInteger(v) && v > 0)) throw new Error('ROI source dimensions must be positive integers');
      if (!Array.isArray(entry.rois) || !entry.rois.length) throw new Error('ROI list must not be empty / ROI 列表不能为空');
      const ids = new Set();
      for (const roi of entry.rois) {
        keys(roi, ['id', 'name', 'x', 'y', 'w', 'h'], 'ROI');
        if (![roi.id, roi.name].every(v => typeof v === 'string' && v.trim()) || ids.has(roi.id)) throw new Error('ROI requires a name and unique id / ROI 需要名称和唯一 ID');
        ids.add(roi.id);
        if (![roi.x, roi.y, roi.w, roi.h].every(Number.isSafeInteger) || roi.x < 0 || roi.y < 0 || roi.w <= 0 || roi.h <= 0 || roi.w > entry.sourceWidth - roi.x || roi.h > entry.sourceHeight - roi.y)
          throw new Error('ROI rectangle outside source image / ROI 超出原图边界');
      }
    }
    const inputNames = files.map(file => basename(file));
    if (new Set(inputNames).size !== inputNames.length || inputNames.some(name => !names.has(name)) || names.size !== inputNames.length) throw new Error('ROI manifest must match every input by unique basename / ROI 清单须完整对应本批所有图像');
    roiManifest = structuredClone(roiManifest);
  }
  return { roiManifest, channels: coloc ? [...(channels ?? ['R', 'G'])] : null, mpp, includeNuclei, reviewDir };
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function pngBuffer(value) {
  if (typeof value !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value)) throw new Error('Invalid review PNG');
  return Buffer.from(value.slice('data:image/png;base64,'.length), 'base64');
}

/** Extract transient image data before serializing results; all output stays in a new local directory. */
export function saveImageReview(result, reviewDir) {
  const images = result.files.map(file => { const data = file.reviewImages; delete file.reviewImages; return data; });
  try {
    const dir = mkdtempSync(join(reviewDir, 'wisplab-review-'));
    const sections = result.files.map((file, index) => {
      const label = result.coloc ? 'IF channel overlay / IF 通道叠加' : 'Positive-stain overlay / 染色阳性叠加';
      let figures = '';
      if (images[index]) {
        const artifacts = {};
        for (const key of ['original', 'overlay']) {
          const data = pngBuffer(images[index][key]);
          const name = `${String(index + 1).padStart(3, '0')}-${key}.png`;
          const path = join(dir, name);
          writeFileSync(path, data, { flag: 'wx', mode: 0o600 });
          artifacts[key] = { path, sha256: sha256(data), kind: key === 'original' ? 'working-image' : result.coloc ? 'if-channel-overlay' : 'positive-stain-overlay', coordinateSpace: 'working', width: file.width, height: file.height };
          figures += `<figure><img alt="${key === 'original' ? 'Working image / 工作图' : label}" src="${images[index][key]}"><figcaption>${key === 'original' ? 'Working image / 工作图' : label}</figcaption></figure>`;
        }
        file.artifacts = artifacts;
      }
      const legend = result.coloc ? 'A only: magenta; B only: green; both: pale violet. / 仅 A：品红；仅 B：绿色；共阳性：浅紫。' : 'Positive stain: violet. / 染色阳性：紫色。';
      return `<section><h2>${escapeHtml(file.file)}</h2>${file.error ? `<p class="error">${escapeHtml(file.error)}</p>` : ''}<div class="images">${figures}</div><p>${legend}</p><pre>${escapeHtml(JSON.stringify(file, null, 2))}</pre></section>`;
    }).join('\n');
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>WispLab image review / 图像复核</title><style>body{font:16px system-ui,sans-serif;max-width:1200px;margin:32px auto;padding:0 20px;color:#172538;background:#f5f7fb}section{background:white;border:1px solid #ccd5e0;padding:20px;margin:24px 0;border-radius:10px}.images{display:flex;flex-wrap:wrap;gap:16px}figure{flex:1;min-width:250px;margin:0}img{max-width:100%;height:auto}figcaption{padding:8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.error{color:#9b1616}</style><h1>WispLab image review / 图像复核</h1><p>Local review copy; research use. / 本地复核副本，供研究使用。</p><p>Overlay shows thresholded stain or IF channel signal, not nucleus boundaries. Cyan rectangles mark imported ROIs. / 叠加显示阈值染色或 IF 通道信号，不是细胞核轮廓；青色矩形表示导入的 ROI。</p><p>PNG dimensions are working-image pixels. Source coordinates, input hashes, settings and provenance are recorded below. / PNG 使用工作图像素；原图坐标、输入哈希、参数与溯源信息见下方。</p>${sections}<section><h2>Run provenance / 运行溯源</h2><pre>${escapeHtml(JSON.stringify(result.provenance, null, 2))}</pre></section></html>`;
    const path = join(dir, 'report.html');
    writeFileSync(path, html, { flag: 'wx', mode: 0o600 });
    result.review = { directory: dir, report: path, sha256: sha256(Buffer.from(html)), selfContained: true };
    writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    result.review = { error: `Local review export failed / 本地复核导出失败: ${error.message}` };
  }
  return result;
}
