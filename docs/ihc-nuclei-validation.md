# IHC 独立核标注与空间比较 / Independent nucleus annotation and spatial comparison

本流程提供本地原图点选标注、可恢复草稿，以及核中心的一对一空间匹配。**目前尚未找到可用于本项目的独立人工标注数据，真实人工准确性验证仍为待完成。** 合成数据的单元测试、浏览器自动点击测试和厂商示例图回归只能验证流程或兼容性，不能替代人工金标准。

This workflow provides local point annotation on original images, resumable drafts, and one-to-one spatial matching of nucleus centers. **Independent human annotations for this project have not yet been located; real human-reference accuracy validation remains pending.** Synthetic unit tests, automated browser clicks, and vendor-image regressions validate workflow or compatibility, not accuracy against a human gold standard.

## 从分析到独立标注 / From analysis to independent annotation

```bash
mkdir -p /tmp/ihc-review
node cli.mjs ihc /data/ihc/slide.png --nuclei > /tmp/ihc-review/result.json
node cli.mjs ihc-annotation-pack /tmp/ihc-review/result.json \
  --images-root /data/ihc --output-dir /tmp/ihc-review
```

第一步需要支持核坐标导出的 IHC 引擎。第二步只读取结果 JSON 和原始图像，无需启动引擎或配置仓库路径。它输出 `ihc-annotation-*` 新目录及 `annotate.html`、`reference-template.json`，状态为 `pending-independent-review`。在本地浏览器打开返回的 HTML 即可标注。

The first command requires an IHC engine that supports nucleus export. Pack creation reads only the result JSON and original images; it does not start an engine or require engine configuration. It creates a new `ihc-annotation-*` directory containing `annotate.html` and `reference-template.json`, with status `pending-independent-review`. Open the returned HTML in a local browser.

原始图像文件名须唯一，并存在于 `--images-root`。文件字节哈希必须与分析时记录的稳定 SHA-256 相同；模板记录原图尺寸、染色预设和坐标空间。当前浏览器标注包只嵌入原始 PNG/JPEG。TIFF 不能仅改扩展名或把转换图冒用原图哈希；使用外部标注工具时，应严格遵循下方参考格式与原图坐标。转换为另一图像格式时属于新的输入，须记录转换并重新建立对应分析及哈希。

Original basenames must be unique and present under `--images-root`. File bytes must match the stable SHA-256 recorded by the analysis. The template records source dimensions, stain profile, and coordinate space. Browser packs currently embed original PNG/JPEG only. Renaming TIFF extensions or assigning an original hash to converted pixels is invalid. External annotation tools must follow the reference format and source-coordinate convention below. A converted image is a new input: record the conversion and establish its own corresponding analysis and hash.

标注页面不包含模型预测的核点。复核者应先确定核纳入规则、阳性判定、边缘核处理和疑难区域处理规则，再逐核标注。看过模型预测后修改标签不再属于同样的盲法独立复核，应如实记录过程。

The annotation page excludes model-predicted points. Reviewers should define nucleus inclusion, positive classification, border handling, and ambiguous-region rules before annotating. Labels edited after inspecting model predictions do not represent the same blinded independent review; record that procedure honestly.

## 浏览器操作与草稿 / Browser controls and drafts

1. 选择图像，在“适应视口 / Fit”查看全图，需要精确点选时切换 100%、200% 或 400%，用滚动条/触控板平移。使用“阳性”或“阴性”模式点击每个核的中心。红色/青色圈标记人工点，不是核轮廓。缩放与滚动不改变原图坐标、已有标注或复核状态。
2. 使用“删除最近标注”移除点。新建或删除点都会把当前图恢复为待复核状态。
   可另行填写本图的独立人工 H-score（0–300，允许小数）；它不由二元阳性/阴性点推算。未评分请留空；填写或清除评分也会撤销本图复核。范围错误会阻止草稿及完整导出。
3. 完整检查当前整图后，勾选“当前整图已完整独立复核”。零核的空白图也必须明确确认，不能将未标注自动视作零核真值。
4. 随时下载草稿。草稿下载会将所有图的状态写为 `pending`；刷新或关闭页面前先保存，没有自动保存。
5. 用“继续草稿”载入已有 JSON。工具校验图像身份、SHA-256、原图尺寸、预设、坐标空间及人工来源，并校验点坐标、ID 和标签。导入后所有图重新设为待复核；不匹配的文件不能替换当前标注。
6. 填写复核者、日期、标注协议，逐图确认完成后下载完整参考。整批任一图未完成时，完整导出会被阻止。

1. Select an image and use Fit for the full view. Switch to 100%, 200%, or 400% for precise clicks, and pan with scrollbars or a trackpad. Click every nucleus center in Positive or Negative mode. Red/cyan rings indicate annotation points, not nuclear outlines. Zoom and scrolling preserve source coordinates, existing annotations, and review status.
2. Erase nearest removes a point. Adding or deleting annotations invalidates the current image's review confirmation.
   Optionally enter an independently assessed H-score for this image (0–300, fractions allowed). It is not inferred from binary positive/negative points. Leave it blank if unscored. Editing or clearing the score also invalidates review; out-of-range values block both draft and complete exports.
3. Check Entire image independently reviewed only after reviewing the complete image. Explicitly confirm zero-nucleus images too; unannotated images are not automatically zero-nucleus ground truth.
4. Save drafts regularly. Draft exports set all images to `pending`; save before reload or closing because there is no autosave.
5. Resume draft loads a JSON file after checking image identity, SHA-256, source dimensions, profile, coordinate space, manual source, and point coordinates/IDs/labels. Imported images return to pending review. A mismatching draft cannot replace current annotations.
6. Enter reviewer, date, and protocol, then confirm every image and export the reviewed reference. Any unfinished image blocks complete export.

标注包和下载文件均保留在本地；HTML 包含原图字节，应按实验数据保存。不要把实验图、标注包或含可识别信息的记录提交到公开仓库。

Packs and downloads stay local. The HTML contains original image bytes and should be stored as experimental data. Do not commit experimental images, packs, or identifying annotation records to a public repository.

## 参考数据格式与坐标 / Reference format and coordinates

```json
{
  "schemaVersion": "wisplab.ihc-nuclei-reference/v1",
  "images": [{
    "file": "slide.png",
    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "profile": "h_dab",
    "coordinateSpace": "source",
    "sourceWidth": 2048,
    "sourceHeight": 1536,
    "sourceKind": "manual",
    "reviewStatus": "complete",
    "reviewer": "Reviewer identifier",
    "reviewedOn": "2026-10-31",
    "method": "Independent complete-image centroid review; predefined positivity and border rules",
    "hScore": 123.5,
    "points": [{"id": "manual-1", "x": 100.5, "y": 200.25, "positive": true}]
  }]
}
```

示例哈希是占位值，不能用于实际比较。每张图最多 20,000 个点；ID 在图内唯一，`positive` 必须为布尔值。坐标是**原图像素中心索引**：左上像素中心为 `(0,0)`，允许有限小数，须满足 `0 ≤ x < sourceWidth`、`0 ≤ y < sourceHeight`。这与矩形 ROI 的边界坐标不同。完成参考必须提供非空复核者、方法及有效 `YYYY-MM-DD` 日期。

`hScore` 是可选独立评分字段，须为 0–300 的有限数字；未评分时省略字段，不使用 `null`、空字符串或默认零。数值 `0` 是明确的零分，导出时保留。草稿导入、切换图像和缩放均保留各图自己的评分。

The example hash is a placeholder, not a usable identity. Each image supports at most 20,000 points; IDs must be unique within that image and `positive` must be boolean. Coordinates are **source pixel-center indices**: the top-left pixel center is `(0,0)`. Finite fractional coordinates are allowed within `0 ≤ x < sourceWidth` and `0 ≤ y < sourceHeight`. These differ from rectangular ROI edge coordinates. Completed references require nonempty reviewer/method and a valid `YYYY-MM-DD` date.

`hScore` is an optional independent score: a finite number from 0 to 300. Omit the field for unscored images rather than writing `null`, an empty string, or a default zero. Numeric `0` is an explicit zero score and is retained. Draft import, image switching, and zoom preserve each image's own score.

预测核中心由工作图转换回原图后进行匹配：

```text
sourceX = (workingX + 0.5) × sourceWidth / workingWidth − 0.5
sourceY = (workingY + 0.5) × sourceHeight / workingHeight − 0.5
```

Predicted working-image centers are converted back using the formula above. X/Y use their actual dimensions separately, preserving pixel-center alignment when resize rounding differs by axis.

`sourceKind` 可为 `manual`、`independent-computation` 或 `synthetic`，表示参考数据来源。浏览器新建模板的 `manual` 只是待人工填写的用途标识，空白模板仍是 `pending`，不代表人工复核已发生。自动计算、从模型预测复制的标签或厂商示例图不得改名为独立人工真值。

`sourceKind` may be `manual`, `independent-computation`, or `synthetic`, describing reference provenance. The browser template's initial `manual` value identifies its intended use; an empty template remains `pending` and does not assert completed human review. Computed labels, copied model predictions, or vendor examples must not be relabeled as independent human ground truth.

## 离线比较与结果解释 / Offline comparison and interpretation

在查看模型预测前确定匹配半径；单位是**原图像素**，不是工作图像素或微米。一次比较使用同一个半径，混用采集倍率时应先设计一致的评价方案。

Choose the matching radius before inspecting predictions. Its unit is **source pixels**, not working pixels or micrometers. A comparison uses one radius; define a consistent evaluation design before mixing acquisition scales.

```bash
node cli.mjs ihc-nuclei-validate /tmp/ihc-review/result.json \
  nuclei-reference.json --match-radius 8 > nuclei-comparison.json
```

比较无需引擎配置。它校验图像哈希、预设、尺寸、核导出格式及分析溯源稳定性，将中心距离在半径内的点做一对一最大匹配。候选按距离与 ID 排序，类别不参与配对；算法最大化匹配数，不承诺全局距离和最小。

Comparison requires no engine configuration. It checks hashes, profiles, dimensions, nucleus export, and provenance stability, then finds a maximum-cardinality one-to-one match within the radius. Candidates are distance/ID ordered, and positive/negative labels do not influence assignment. The method maximizes match count; it does not guarantee minimum total distance.

| 输出 / Output | 含义 / Meaning |
| --- | --- |
| `detection.truePositives` | 匹配到的核数量，与阳性染色类别无关 / Matched nuclei, regardless of stain class |
| `falsePositives` / `falseNegatives` | 未匹配预测核 / 未匹配参考核；ID 同时列出 / Unmatched predicted/reference nuclei, with IDs |
| `precision`, `recall`, `f1` | 核中心检测指标；分母为零时为 `null` / Centroid detection metrics; undefined denominators yield `null` |
| `classificationOnMatched` | 仅匹配核的阳性/阴性混淆矩阵与准确率 / Positivity confusion matrix and accuracy conditional on matched nuclei |
| 每图 `hScore`、`hScoreSummary` / Per-image `hScore`, `hScoreSummary` | 有独立评分时报告观察值减参考值的有符号误差、绝对误差，以及已评分图的平均绝对/有符号误差；没有评分则不推算 / Optional observed-minus-reference signed and absolute errors, plus mean absolute/signed errors across scored images; no inferred scores |
| `pending-review` | 仍有未完成人工参考，不能据此宣称完成准确性验证 / Unfinished reference review; no completed accuracy claim |
| `incomplete` | 哈希/范围/导出不符、未引用图像或溯源检查不稳定 / Identity/scope/export mismatch, uncovered images, or unstable provenance |
| `compared` | 已完成规定比较，无内置“通过”阈值 / Comparison completed; no built-in acceptance threshold |

`compared` 的 CLI 退出码为 0，其余状态为 1；**退出码 0 不代表达到精度要求**。容差和验收标准应在评价前另行制定。汇总指标会合并已比较图像，必须同时查看每图 `sourceKind` 和异常/待完成记录；混合合成与人工数据的总汇不能作为纯人工验证结果。

CLI exit code is 0 for `compared` and 1 for other statuses. **Exit code 0 does not establish acceptable accuracy.** Define acceptance criteria before evaluation. Summaries pool compared images, so inspect per-image `sourceKind` and incomplete/pending records too. A mixed synthetic/manual aggregate is not a purely human-reference validation result.

该流程评价中心检测和匹配核分类，不输出 Dice/IoU 等轮廓重叠指标，也不单凭核总数误差证明分割准确。附加的独立人工 H-score 可用于单独报告评分误差；它与空间匹配指标分开，不从二元核标签推算。已有 `ihc-validate` 仍可用于其他聚合参考值比较。完成真实评价仍需独立标注、代表性图像和预先定义的评价协议。

This workflow evaluates center detection and matched-nucleus classification. It does not produce mask-overlap Dice/IoU or establish segmentation accuracy from aggregate count agreement. Optional independent H-scores support a separately reported score error, distinct from spatial matching and never inferred from binary labels. The existing `ihc-validate` command remains available for other aggregate-reference comparisons. Real evaluation still requires independent annotations, representative images, and a predefined protocol.
