---
name: wisplab-if-colocalization
description: >-
  Quantify immunofluorescence colocalization on duplex/multiplex fluorescence
  images: per-channel thresholds, Pearson correlation (whole and masked),
  Manders M1/M2 coefficients. Use whenever the user gives you an
  免疫荧光/IF/荧光双染/共定位/multiplex image or asks about 共定位系数/Pearson/
  Manders/通道重叠/荧光定量 — even without saying "WispLab". You (the agent)
  construct and run the wisplab if command yourself; the user never needs CLI
  syntax. Not for brightfield IHC / H&E / Masson (use
  wisplab-ihc-quantification), Western blots, or qPCR.
---

# IF 共定位 / Immunofluorescence colocalization

使用 `wisplab if` 或 MCP `if_colocalize` 分析已有图像，解释实际输出，不编造通道身份或数值。
Use `wisplab if` or MCP `if_colocalize` on supplied images. Interpret actual output without inventing channel identities or measurements.

## 环境与通道 / Setup and channels

运行 `wisplab doctor`；没有全局命令时使用 `node /path/to/wisplab-cli/cli.mjs doctor`。IHC/IF 共用配置的病理引擎、Vite、Playwright 和 Chromium。
Run `wisplab doctor`, or `node /path/to/wisplab-cli/cli.mjs doctor` at the installed location. IHC/IF share the configured pathology engine, Vite, Playwright, and Chromium.

执行前从图像和已有上下文确认红/绿通道分别是什么；仅在信息缺失时询问。CLI 可用 `--channels R,B` 等参数选择两个不同 RGB 通道，MCP 使用 `channels: ["R", "B"]`，默认仍为 **R 对 G**。伪彩红/青不自动等于两种独立原始荧光通道；不能用 R/G 输出代替用户实际要求的 R/B 结果。
Before execution, establish the meaning of the red/green channels from the image and context; ask only if missing. Select two distinct RGB channels with `--channels R,B` or MCP `channels: ["R", "B"]`; the default remains **R versus G**. Pseudocolor red/cyan is not automatically equivalent to independent original fluorescence channels; do not substitute R/G output for a requested R/B analysis.

```sh
wisplab if /path/to/duplex.png --channels R,B
```

默认逐通道背景为第 5 百分位，阈值为逐通道 Otsu。接受 JPEG/PNG/TIFF；病理引擎会把最长边超过 4096 像素的图降采样，并把 16 位 TIFF 转为 8 位工作像素。保留这些处理信息以便复现。
Defaults use the 5th percentile for each channel's background and per-channel Otsu thresholds. JPEG/PNG/TIFF are accepted; the pathology engine downsamples images longer than 4096 pixels and converts 16-bit TIFF to 8-bit working pixels. Preserve these processing details for reproducibility.

## 结果 / Results

读取 `files[].coloc` 和 `warnings`，连同所用通道、背景和阈值报告：
Read `files[].coloc` and `warnings`; report channels, background levels, thresholds, and:

| 字段 / Field | 含义 / Meaning |
| --- | --- |
| `pearsonAll` | 全图背景扣除后相关 / Correlation over the background-corrected whole image |
| `pearsonMasked` | 任一通道过阈值的像素并集上的相关，不是双阳性交集 / Correlation over the union of pixels above either channel's threshold, not the double-positive intersection |
| `mandersM1` | 背景扣除后的 A 总信号中位于 B 过阈值区域的比例 / Fraction of total background-corrected A signal located where B exceeds its threshold |
| `mandersM2` | 反向比例 / Corresponding reverse fraction |

不要平均 M1/M2，也不要只凭一个系数断言物理相互作用。背景、阈值、串色、分辨率和显示合成方式都会影响解释。阈值后 Pearson 的值与全图不同不一定表示程序错误。
Do not average M1/M2 or infer physical interaction from a coefficient alone. Background, thresholds, bleed-through, resolution, and image compositing affect interpretation. A difference between masked and whole-image Pearson need not indicate a software error.

可用 `--review-dir`（MCP `reviewDir`）向已存在目录导出本地工作图、通道叠加 PNG、HTML 与结果 JSON；先检查 `review.error` 和逐图 `error`。IF 仍只分析整图，不支持 ROI、任意光谱通道或手工阈值。保存输入、所选通道、参数与引擎修订；历史参考数值不是本次通过标准。
Use `--review-dir` (MCP `reviewDir`) with an existing directory for local working/overlay PNGs, HTML and result JSON; inspect `review.error` and per-image errors. IF remains whole-image and exposes no ROI import, arbitrary spectral channels or manual thresholds. Record inputs, selected channels, parameters and revisions; historical values are not current pass criteria.

计算本地运行；AI 客户端可能向模型服务发送工具结果或附件。
Computation is local; the AI client may send tool results or attachments to its model provider.


运行前区分 `doctor.ready` 与 `verified`；需要本仓库已验证修订时运行 `wisplab doctor --strict`。新装可用 `node scripts/setup-engines.mjs --root NEW_DIRECTORY --config NEW_FILE`，不覆盖已有目录/配置；路径以实际 CLI 安装位置为准。
Distinguish `doctor.ready` from `verified`; use `wisplab doctor --strict` for this bridge's verified revisions. New installs can use `node scripts/setup-engines.mjs --root NEW_DIRECTORY --config NEW_FILE`, which refuses existing paths; resolve the script from the installed CLI location.

CLI `--timeout-ms` 与 `--file-timeout-ms`（MCP `runtime.timeoutMs` / `fileTimeoutMs`）默认分别为 300000 / 120000 ms。单图超时保留先前结果并重启处理后续图；整批超时或取消结束未完成项。CLI 进度在 stderr；MCP 仅对提供进度 token 的请求发送，取消后不再返回该请求结果。MCP 的 `reviewDir` 必须通过 `allowPaths` 检查。详见[运行控制](../../docs/runtime-controls.md)。
CLI `--timeout-ms` and `--file-timeout-ms` (MCP `runtime.timeoutMs` / `fileTimeoutMs`) default to 300000 / 120000 ms. An image timeout preserves completed results and restarts for later images; batch timeout/cancellation ends unfinished work. CLI progress uses stderr; MCP progress requires a token and cancelled requests send no further result. MCP `reviewDir` must pass `allowPaths`. See [runtime controls](../../docs/runtime-controls.md).
