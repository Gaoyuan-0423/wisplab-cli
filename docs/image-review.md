# 图像 ROI 与本地复核 / Image ROIs and local review

WispLab 可以在原图哈希约束下导入 IHC 矩形 ROI，选择 IF 的两个 RGB 通道，并生成本地复核 PNG 和自包含 HTML。全部图像处理在本机进行，不上传实验图像。复核图显示染色或荧光通道信号，**不是细胞核轮廓**。这些功能帮助核查分析范围和参数，不构成人工标注准确性验证。

WispLab imports SHA-bound rectangular IHC ROIs, selects two RGB channels for IF, and writes local PNGs plus a self-contained HTML review. Processing stays on the local machine. The overlay shows stain or fluorescence signal, **not nucleus boundaries**. Review artifacts help inspect analysis scope and settings; they do not establish accuracy against human annotations.

## CLI

```bash
mkdir -p /tmp/wisplab-reviews
node cli.mjs ihc slide.png --roi-manifest rois.json --mpp 0.5 \
  --nuclei --review-dir /tmp/wisplab-reviews > result.json
node cli.mjs if fluorescence.png --channels R,B \
  --review-dir /tmp/wisplab-reviews > if-result.json
```

`--roi-manifest`、`--mpp`、`--nuclei` 均可省略。默认仍分析整图；IF 默认 R,G。`--review-dir` 必须为已存在的目录；每次运行新建 `wisplab-review-*` 子目录，不覆盖已有结果。报告路径返回在 `review.report`，PNG 路径与哈希在各图的 `artifacts`。同目录保存完整 `result.json`。导出失败时保留计算结果，返回 `review.error`，CLI 退出码为 1，MCP `isError` 为 true。

`--roi-manifest`, `--mpp`, and `--nuclei` are optional. Whole-image analysis remains the default; IF defaults to R,G. `--review-dir` must already exist. Each run creates a new `wisplab-review-*` directory, leaving previous results intact. `review.report` points to the HTML; per-file `artifacts` records PNG paths and hashes. A complete `result.json` is written alongside it. Export failures retain scientific results and return `review.error`, CLI exit code 1, and MCP `isError: true`.

## ROI 清单 / ROI manifest

先运行不带 ROI 的分析，可从输出读取 `inputSha256`、`sourceWidth`、`sourceHeight`。以下 JSON 的哈希为占位值，必须替换为**原始文件字节**的 SHA-256；不能使用重编码 PNG 的哈希。

First run without ROI import to obtain `inputSha256`, `sourceWidth`, and `sourceHeight`. The hash below is a placeholder: replace it with the SHA-256 of the **original file bytes**, not a re-encoded PNG.

```json
{
  "schemaVersion": "wisplab.rois/v1",
  "images": [{
    "file": "slide.png",
    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "coordinateSpace": "source",
    "sourceWidth": 2048,
    "sourceHeight": 1536,
    "rois": [{"id": "tumor-1", "name": "Tumor / 肿瘤", "x": 100, "y": 200, "w": 600, "h": 500}]
  }]
}
```

- `file` 是唯一文件名，不含目录。提供清单时，须完整覆盖本批输入，不能出现额外图像或同名输入。每张图的 ROI ID 唯一，名称非空。
- `coordinateSpace` 目前仅接受 `source`：解码后原图左上角为 `(0,0)`，x 向右，y 向下；所有坐标为整数像素。矩形为半开区间 `[x,x+w) × [y,y+h)`。宽高须正数，不允许超出原图。
- 哈希或实际原图尺寸不匹配时，该图报告错误，继续处理同批其他图；清单结构或覆盖范围错误在分析前拒绝。

- `file` is a unique basename, without directories. A supplied manifest must cover the entire input batch with no extra images or ambiguous duplicate basenames. ROI IDs must be unique within an image, and names must be nonempty.
- `coordinateSpace` currently accepts only `source`: decoded original pixels with origin `(0,0)` at the top left, x to the right and y downward. Integer rectangles use half-open bounds `[x,x+w) × [y,y+h)`. Width and height must be positive; out-of-bounds rectangles are rejected.
- Hash or actual source-size mismatches become per-file errors while later inputs continue. Invalid manifest structure or batch coverage is rejected before analysis.

## 缩放与计数语义 / Scaling and counting semantics

引擎可能将大图缩至最长边 4096。`roiMapping` 记录原图/工作图尺寸、实际 `scaleX = workingWidth/sourceWidth` 和 `scaleY = workingHeight/sourceHeight`，以及每个 ROI 的 `source` 与 `working` 矩形。变换规则：左/上边界向下取整，右/下边界向上取整。这样覆盖原始区域，但边缘可能多纳入不足一个工作像素；极小 ROI 应结合叠加图核查。

The engine may resize large inputs to a maximum edge of 4096. `roiMapping` records source/working dimensions, actual `scaleX = workingWidth/sourceWidth` and `scaleY = workingHeight/sourceHeight`, and each ROI's `source` and `working` rectangles. Left/top bounds are floored; right/bottom bounds are ceiled. This covers the source rectangle but may add less than one working pixel along its edges; inspect very small ROIs in the overlay.

`overall` 保持整图指标，`perRoi` 提供区域指标。阈值和分割在完整工作图上计算一次，所有 ROI 共享；不会分别为每个 ROI 重做 Otsu。核是否位于 ROI 中按工作图核中心判断；重叠 ROI 可重复计入同一核，因此不能把重叠 ROI 计数直接相加。ROI 不会改变整图计数。

`overall` retains whole-image metrics; `perRoi` contains region metrics. Thresholding and segmentation run once on the full working image and are shared by all ROIs; Otsu is not recomputed independently for each ROI. Nucleus membership uses the nucleus center in working coordinates. Overlapping ROIs may include the same nucleus, so their counts cannot be summed as independent totals. ROIs do not change whole-image counts.

`--mpp` 是**原图**的微米/像素，须来自可靠的采集标尺；工具不猜测。返回 `settings.sourceMpp` 和实际用于面积密度的 `settings.calibration.mpp = sourceMpp / sqrt(scaleX * scaleY)`。由于尺寸取整，两个方向缩放可能略不同，该值用于等面积校正，不代表轴向长度测量。未给标尺时密度保持不可用，不伪造每平方毫米计数。

`--mpp` is micrometers per **source** pixel, supplied from a reliable acquisition calibration; it is never guessed. Results record `settings.sourceMpp` and the area-equivalent `settings.calibration.mpp = sourceMpp / sqrt(scaleX * scaleY)`. Resize rounding can make axis scales slightly different: this value corrects areas, not directional length measurements. Without calibration, density remains unavailable.

## IF 通道 / IF channels

`--channels R,G`、`R,B`、`G,B` 及其倒序均可，但必须是两个不同通道。顺序定义 A/B，因而影响 Manders M1/M2 的解释。这里只选择解码后 RGB 图像中的分量，不能恢复已合并图丢失的原始光谱通道，也不做光谱拆分。当前 ROI 导入仅适用于 IHC；IF 会明确拒绝 ROI，以免改变整图背景/阈值语义。

Any ordered pair of distinct R/G/B channels is supported. Order defines A/B and therefore the interpretation of Manders M1/M2. Selection uses decoded RGB components; it does not recover acquisition channels lost during merging or perform spectral unmixing. ROI import currently supports IHC only; IF explicitly rejects ROI input to avoid changing full-image background/threshold semantics.

## 核中心与人工标注 / Nucleus centers and human review

`--nuclei` 输出 `nuclei: {coordinateSpace: "working", width, height, items: [...]}`，每项含 `id`、`x`、`y`、`meanOd`、`positive`、`touchesBorder`。这些是引擎分割出的中心与分类，不是人工真值或核轮廓；ID 仅在本次图像分析内有效。配置的引擎若不支持导出，将明确报错，不静默返回空数组。

`--nuclei` returns `nuclei: {coordinateSpace: "working", width, height, items: [...]}` with `id`, `x`, `y`, `meanOd`, `positive`, and `touchesBorder`. These are engine-derived centers and classifications, not human ground truth or nucleus outlines. IDs are local to one image analysis. Engines that do not support nucleus export produce an explicit error instead of silently returning an empty array.

## MCP 与报告 / MCP and reports

`ihc_quantify` 接受 `roiManifest` 对象（格式同上）、`mpp`、`includeNuclei`、`reviewDir`；`if_colocalize` 接受 `channels: ["R", "B"]`、`reviewDir`。MCP 会按 `allowPaths` 检查输出目录，解析符号链接后仍须位于允许范围。ROI 清单对象本身不触发其他路径读取。

`ihc_quantify` accepts a `roiManifest` object (same schema), `mpp`, `includeNuclei`, and `reviewDir`; `if_colocalize` accepts `channels: ["R", "B"]` and `reviewDir`. MCP checks output directories against `allowPaths`, including the resolved symlink target. The manifest object does not cause additional file reads.

HTML 内嵌工作图与叠加 PNG、逐图指标、ROI 映射、参数、输入哈希和运行溯源，不依赖外网脚本、字体或图片。所有文本均转义；文件名不用于生成输出路径。青色矩形仅标明 ROI 范围。PNG 尺寸为工作图尺寸，不是原始大图尺寸；`original` 指解码/缩放后的工作图副本，原文件保持不变。报告包含原图像素内容，应按实验数据管理；不会自动上传、提交 Git 或分享。

The HTML embeds working and overlay PNGs, per-file metrics, ROI mappings, settings, input hashes, and provenance. It uses no external scripts, fonts, or images. All text is escaped, and input filenames never determine output paths. Cyan rectangles identify ROI bounds only. PNG dimensions match the working image, not necessarily the full-resolution source; `original` means the decoded/resized working copy. Source files remain untouched. The report contains image content and should be handled as experimental data; it is never automatically uploaded, committed to Git, or shared.

厂商示例图可用于兼容性与回归检查，不能作为人工标注金标准。核中心、阳性分类或 H-score 的准确性验证仍需要独立人工标注及预先定义的容差。

Vendor example images can support compatibility and regression checks, but are not a human-annotated gold standard. Accuracy assessment of nucleus centers, positive classification, or H-score still requires independent human annotations and predefined tolerances.
