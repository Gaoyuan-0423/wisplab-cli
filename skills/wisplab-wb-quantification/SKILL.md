---
name: wisplab-wb-quantification
description: >-
  Quantify Western blot membrane images (lane/band detection, rolling-ball or
  local background subtraction, reference-lane normalization ratios). Use
  whenever the user gives you a membrane/blot image or asks about Western blot
  quantification — 泳道/条带/灰度/定量/归一化/内参/rolling ball/相对表达量/
  chemical dilution series/ECL — even without saying "WispLab". You (the agent)
  construct and run the wisplab command yourself; the user never needs to learn
  CLI syntax. Not for IHC/IF histology images or qPCR tables.
---

# WB 定量 / Western blot quantification

使用 `wisplab wb` 或 MCP `wb_quantify`，把实际测量结果整理为表格。先利用用户已提供的信息；仅在缺少必要实验信息时询问。
Use `wisplab wb` or MCP `wb_quantify` and summarize the actual measurements. Reuse information already provided; ask only for missing experimental details.

## 环境 / Setup

运行 `wisplab doctor`。若没有全局命令，使用已找到的 CLI 路径：`node /path/to/wisplab-cli/cli.mjs doctor`。不要假设作者电脑上的路径存在。
Run `wisplab doctor`, or use `node /path/to/wisplab-cli/cli.mjs doctor` with the installed location. Do not assume an author's machine-specific path exists.

## 输入与参数 / Input and parameters

- 优先使用原始 PNG/TIFF（8/16 位）。JPEG 转格式不能恢复丢失的信息，不应声称转换后适合无损定量。
  Prefer original PNG/TIFF (8/16-bit). Converting JPEG does not recover lost information.
- 看图并确认目标面板、泳道数、亮/暗信号和对照泳道。使用原图尺寸，不把缩放预览坐标当原始像素。
  Inspect the target panel, lane count, dark/light signal, and control lane. Use original pixel coordinates, not scaled-preview coordinates.
- 多面板图使用 `--strip y,h,x0,x1`，排除 marker、文字和其他面板，同时保留背景余量。自动泳道提议需复核，失败时不得为获得结果而擅自改变预期泳道数。
  For multiple panels use `--strip y,h,x0,x1`, excluding markers, labels, and other panels while retaining background margins. Review proposals; do not change the expected lane count merely to obtain a result.
- 默认 `--bg local`、`--signal dark`、`--control 1`；按实际实验需求选择 `--bg rolling:50` 或 `--signal light`。背景方法不同，数值不能直接互换。
  Defaults are `--bg local`, `--signal dark`, and `--control 1`. Select rolling-ball or light signal based on the experiment; different background methods are not interchangeable.

```sh
wisplab wb /path/to/blot.png --strip "140,85,160,350" --lanes 6 --bg rolling:50 --signal dark --control 2
```

## 结果 / Results

读取 `images[].lanes[]` 的 `net`、`ratio`、框坐标和 `warnings`，同时检查逐图 `error`。`ratio` 是该泳道净信号除以指定对照泳道净信号；对照净信号为正时，其自身比值为 1。不能把它称为已完成目标蛋白/上样内参双重归一化的表达量。
Read `net`, `ratio`, region coordinates, and `warnings` in `images[].lanes[]`, plus per-image `error`. The ratio divides by the specified control lane's net signal; a positive control has a ratio of 1 to itself. This is not automatic target/loading-control normalization across images.

报告饱和、非正净信号和边界问题；保留 `null`，不要改写为 0。跨膜比较需要额外实验设计和内参处理。需要手工 ROI、叠加图或报告时使用上游界面。
Report saturation, nonpositive signal, and boundary warnings. Preserve `null` rather than replacing it with zero. Cross-membrane comparisons need additional design and normalization. Use the upstream GUI for manual ROIs, overlays, or reports.

## 复现 / Reproducibility

保存输入、参数和 `doctor` 返回的引擎修订。历史 ImageJ parity 只适用于记录中的数据、参数和版本，不代表所有图像或整条流程无条件一致。`grade wb` 需要另行安装相邻的 `wisplab-benchmark` 及材料。
Record inputs, parameters, and engine revisions from `doctor`. Historical ImageJ parity applies to the recorded data, parameters, and versions, not unconditionally to every image or workflow. `grade wb` requires the separate adjacent `wisplab-benchmark` and materials.

计算本地运行，但 AI 客户端可能向模型服务发送结果或附件；不得声称数据必然不离开电脑。
Computation is local, but the AI client may send results or attachments to its model provider; do not promise that data never leaves the computer.
