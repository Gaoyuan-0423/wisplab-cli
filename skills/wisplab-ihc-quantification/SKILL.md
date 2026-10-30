---
name: wisplab-ihc-quantification
description: >-
  Quantify IHC / immunohistochemistry and special-stain histology images
  (H-DAB, H&E, Masson trichrome): positive-area percentage, H-score, nuclei
  segmentation and counting, control-slide calibrated thresholds. Use whenever
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

当前接口是整图默认参数；不提供手工 ROI、标尺标定、全部分割选项或模型选择。不能编造个/mm² 密度。需可视化复核时使用上游界面。
The bridge uses whole-image defaults without manual ROIs, scale calibration, all segmentation controls, or model selection. Do not invent per-mm² density. Use the upstream GUI for visual review.

保存输入、参数和引擎修订。`grade ihc` 依赖另行安装的相邻 `wisplab-benchmark` 与对应材料；旧校准数字不是本次结果的验证。
Record inputs, parameters, and engine revisions. `grade ihc` requires the separately installed adjacent `wisplab-benchmark` and materials; old calibration numbers do not validate the current result.

计算本地运行；AI 客户端的数据传输取决于客户端设置。
Computation is local; AI-client data transfers depend on client settings.
