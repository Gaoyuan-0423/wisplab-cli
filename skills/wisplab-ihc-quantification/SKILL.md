---
name: wisplab-ihc-quantification
description: >-
  Quantify IHC / immunohistochemistry and special-stain histology images
  (H-DAB, H&E, Masson trichrome): positive-area percentage, H-score, nuclei
  segmentation/counting, SHA-bound rectangular ROIs, mpp, nucleus-center export,
  local review artifacts and control-slide calibrated thresholds. Use whenever
  the user gives you an IHC/组织切片/免疫组化/苏木精伊红/HE/Masson/三色/胶原 image
  or asks about 阳性面积/H-score/标注指数/细胞核计数/DAB定量 — even without
  saying "WispLab". You (the agent) construct and run the wisplab ihc command
  yourself; the user never needs CLI syntax. Not for immunofluorescence
  colocalization (use wisplab-if-colocalization), Western blots, or qPCR.
---

# IHC／染色定量 / IHC and histology quantification

使用 `wisplab ihc` 或 MCP `ihc_quantify`，报告实际引擎输出及其限制。
Use `wisplab ihc` or MCP `ihc_quantify` and report actual engine output and its limits.

## 环境 / Setup

运行 `wisplab doctor`；未安装全局命令时使用 `node /path/to/wisplab-cli/cli.mjs doctor`。IHC/IF 需要配置的病理仓库中的 Vite、Playwright 和 Chromium。调用会启动本地服务并在结束后回收；端口冲突时修改 `ihc.devPort`。
Run `wisplab doctor`, or `node /path/to/wisplab-cli/cli.mjs doctor` at the installed location. IHC/IF require Vite, Playwright, and Chromium from the configured pathology setup. Calls start and clean up a local server; change `ihc.devPort` for a port conflict.

## 输入与执行 / Input and execution

| 染色 / Stain | 参数 / Option |
| --- | --- |
| H-DAB / IHC | `--profile h_dab`（默认 / default） |
| H&E | `--profile h_eosin` |
| Masson | `--profile masson` |

```sh
wisplab ihc /path/to/section.tif --profile h_dab
wisplab ihc /path/to/section.tif --profile h_dab --control-tif /path/to/negative.tif
```

接受 JPEG/PNG/TIFF。病理引擎在最长边超过 4096 像素时降采样，16 位 TIFF 转成 8 位工作像素，不是原始 16 位像素强度定量。厂商全切片格式需先在采集软件中导出受支持的图像。
JPEG/PNG/TIFF are accepted. The pathology engine downsamples images longer than 4096 pixels and converts 16-bit TIFF into 8-bit working pixels; this is not raw 16-bit intensity quantification. Export supported images from acquisition software for proprietary whole-slide formats.

对照片标定当前限 H-DAB；使用与样本条件匹配的可信阴性对照片。阈值按对照片的 0.1% 假阳率目标计算，不保证样本上的实际假阳率也为 0.1%。无对照片时使用引擎默认阈值，保留低分离度等警告。
Control calibration currently supports H-DAB only. Use a suitable negative control acquired under matching conditions. Its 0.1% false-positive target is estimated on the control and does not guarantee that rate on the sample. Without a control, retain warnings from the engine's default thresholding.

## 结果 / Results

读取 `files[].overall`、`thresholdUsed`、`backgroundLevel`、`warnings` 和 `qc`。`positiveFraction`、`labelingIndex` 是比例，展示百分数时乘 100。报告检出的阳性核和总核数量。
Read `files[].overall`, `thresholdUsed`, `backgroundLevel`, `warnings`, and `qc`. Multiply `positiveFraction` and `labelingIndex` by 100 when presenting percentages. Report positive and total detected nuclei.

`hScore` 来自检测核的平均染色强度分级，不能泛称为所有膜/胞质标记的临床 H-score，也不能未经验证代替人工病理评分。核分割错误会影响核计数、标注指数和 H-score。
`hScore` is derived from intensity categories of detected nuclei. Do not present it as a universal clinical H-score for membrane/cytoplasmic markers or an unvalidated replacement for manual pathology scoring. Segmentation errors affect counts, labeling index, and H-score.

默认分析整图；可用 `--roi-manifest rois.json` 导入哈希绑定的原图矩形 ROI，`--mpp` 使用可信的原图 µm/px。检查 `roiMapping`、`perRoi` 和实际缩放信息。`--nuclei` 导出工作图核中心而非轮廓；`--review-dir` 向已存在目录写本地 PNG/HTML 和结果 JSON，检查 `review.error`。叠加显示染色阳性，不是核分割轮廓。未暴露全部分割设置或模型选择；未知标尺时不能编造个/mm² 密度。
Whole-image analysis is the default. Import hash-bound source-pixel rectangles with `--roi-manifest rois.json` and use `--mpp` only for a trustworthy source µm/px. Inspect `roiMapping`, `perRoi` and actual resizing. `--nuclei` exports working-image centers, not outlines; `--review-dir` writes local PNG/HTML and result JSON into an existing directory. Check `review.error`. Overlays show positive stain, not nuclear contours. Full segmentation controls and model selection remain unavailable; never invent per-mm² density without a known scale.

人工复核可用离线 `ihc-annotation-pack result.json --images-root DIR --output-dir DIR` 创建原始 PNG/JPEG 点选包；标注页面不显示预测点，支持保存/恢复草稿及可选独立人工 H-score。用 `ihc-nuclei-validate result.json reference.json --match-radius 8` 按预先选定的原图像素半径做一对一核中心比较。`compared` 不是精度达标；二元点标签不能推导人工 H-score，也不提供 Dice/IoU。真实人工准确性验证仍待独立标注完成，不得把自动核点或厂商样例改称人工真值。
For independent review, offline `ihc-annotation-pack result.json --images-root DIR --output-dir DIR` creates original PNG/JPEG point-annotation packs without predicted points, with saved/resumed drafts and optional independent H-scores. `ihc-nuclei-validate result.json reference.json --match-radius 8` performs one-to-one centroid comparison using a preselected source-pixel radius. `compared` is not an accuracy pass; binary labels cannot supply an independent H-score, and Dice/IoU are not provided. Real human-reference validation remains pending; never relabel automated points or vendor samples as manual truth.

[图像与 ROI / Image review](../../docs/image-review.md) · [独立核标注 / Independent annotations](../../docs/ihc-nuclei-validation.md).

保存输入、参数和引擎修订。`grade ihc` 依赖另行安装的相邻 `wisplab-benchmark` 与对应材料；旧校准数字不是本次结果的验证。
Record inputs, parameters, and engine revisions. `grade ihc` requires the separately installed adjacent `wisplab-benchmark` and materials; old calibration numbers do not validate the current result.

计算本地运行；AI 客户端的数据传输取决于客户端设置。
Computation is local; AI-client data transfers depend on client settings.


运行前区分 `doctor.ready` 与 `verified`；需要本仓库已验证修订时运行 `wisplab doctor --strict`。新装可用 `node scripts/setup-engines.mjs --root NEW_DIRECTORY --config NEW_FILE`，不覆盖已有目录/配置；路径以实际 CLI 安装位置为准。
Distinguish `doctor.ready` from `verified`; use `wisplab doctor --strict` for this bridge's verified revisions. New installs can use `node scripts/setup-engines.mjs --root NEW_DIRECTORY --config NEW_FILE`, which refuses existing paths; resolve the script from the installed CLI location.

CLI `--timeout-ms` 与 `--file-timeout-ms`（MCP `runtime.timeoutMs` / `fileTimeoutMs`）默认分别为 300000 / 120000 ms。单图超时保留先前结果并重启处理后续图；整批超时或取消结束未完成项。CLI 进度在 stderr；MCP 仅对提供进度 token 的请求发送，取消后不再返回该请求结果。MCP 的 `reviewDir` 必须通过 `allowPaths` 检查。详见[运行控制](../../docs/runtime-controls.md)。
CLI `--timeout-ms` and `--file-timeout-ms` (MCP `runtime.timeoutMs` / `fileTimeoutMs`) default to 300000 / 120000 ms. An image timeout preserves completed results and restarts for later images; batch timeout/cancellation ends unfinished work. CLI progress uses stderr; MCP progress requires a token and cancelled requests send no further result. MCP `reviewDir` must pass `allowPaths`. See [runtime controls](../../docs/runtime-controls.md).
