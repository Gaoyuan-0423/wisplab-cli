# IHC 参考值对照 / IHC reference comparison

```sh
wisplab ihc image.png > result.json
wisplab ihc-validate result.json reference.json > comparison.json
```

This compares whole-image measurements without changing segmentation or selecting parameters to fit the reference. Each image requires the exact input SHA-256 from `result.provenance.inputs`, the matching profile, an explicit reference method and source type. Manual annotations additionally require reviewer and review date. Use independently recorded references; copying model outputs into a manual reference is not validation.

对照只比较整图指标，不调参。每个参考条目都必须指定图像 SHA-256、染色预设和来源方法。人工标注还需标注者和日期。来源分为 `manual`、`independent-computation` 和 `synthetic`，不能把合成图或软件结果写成人工真值。

Example structure (replace all placeholders and numbers with actual independently obtained references; the hash below is deliberately a placeholder):

```json
{
  "schemaVersion": "wisplab.ihc-reference/v1",
  "images": [{
    "file": "image.png",
    "sha256": "<64 lowercase hex characters from the actual image>",
    "scope": "whole-image",
    "profile": "h_dab",
    "sourceKind": "manual",
    "method": "Independent whole-image review using the stated counting protocol",
    "reviewer": "<reviewer identifier>",
    "reviewedOn": "2026-10-31",
    "metrics": {"totalNuclei": 100, "positiveNuclei": 20},
    "tolerances": {"totalNuclei": 5, "positiveNuclei": 3}
  }]
}
```

Available metrics: `totalNuclei`, `positiveNuclei` (integer counts), `hScore` (0–300), `positiveFraction` (positive **area** fraction, 0–1; not positive-nucleus fraction). Specify only the metrics actually annotated. Tolerances are optional absolute errors in those units; set them before inspecting outputs. No built-in clinical or scientific acceptance thresholds are implied. Image resizing/cropping requires a new reference hash and matching scope.

输出含有符号误差、绝对误差、相对误差、MAE 与最大误差。参考值为零时相对误差为 `null`。没有容差时为 `ungraded`；全部比较指标满足容差才为 `within-tolerance`。超差为 `outside-tolerance`。图像/哈希/预设不符、追溯变化、结果错误或参考覆盖不完整时为 `incomplete`。后两种状态退出码为 1；`ungraded` 的退出码 0 仅表示比较成功，不能视为验证通过。输入的分析 JSON 和参考 JSON 也记录 SHA-256。

Counts and whole-image scores do not establish instance-level segmentation precision/recall, clinical interpretation accuracy, or robustness across scanners. Spatial annotations and matching would be required for segmentation accuracy. This command supports whole images only; ROI references need a separate matching analysis.

## 本地厂商图 / Local vendor corpus

The inspected `IHC测试图` corpus contains a sourced 35-image set: Leica/Proteintech H-DAB 12, Leica H&E 4, Masson/Gomori 2, and Leica IF 17. The source manifest identifies BOND/BOND RX examples, not raw acquisition exports or confirmed scanner metadata. No manual nucleus labels were found in the inspected corpus. The historical independent area calculation is not manual ground truth, and its original inputs lack recorded hashes. IF examples are rendered RGB web images; R/G analysis is not equivalent to unmixed acquisition channels. The existing pseudo-control demonstration is not an actual unstained negative control.

```sh
WISPLAB_CONFIG=/absolute/path/to/config.json \
  node scripts/check-vendor-images.mjs /absolute/path/to/IHC测试图 /absolute/path/to/output
```

该脚本按已有来源清单运行 35 张图，输出每种场景的结果与追溯，以及汇总检查。图像保留在本地，仓库不包含厂商原图。执行成功只能说明当前管线可运行，不能代替人工校准。

## 本次执行 / Current execution

2026-10-31 客户端日期：35/35 图完成（H-DAB 12、H&E 4、三色 2、IF 17），四批运行的输入、引擎与桥接代码前后检查均一致。没有人工标注，因此没有报告人工准确率。旧独立计算参考仅 6 个整图条目可与当前整图接口比较；4 个 ROI 条目不参与整图比较。

All 35 images completed, with unchanged input/engine/bridge checks for all four batches. No manual accuracy is reported. Six whole-image historical computational references can be compared descriptively; four ROI entries are excluded from whole-image comparison. Original historical reference inputs were not hash-bound.

| Image | Current positive area % | Historical reference % | Absolute difference (pp) |
| --- | ---: | ---: | ---: |
| ptglab_ki67_110311.jpg | 31.6681 | 31.7877 | 0.1197 |
| ptglab_ki67_110312.jpg | 30.7040 | 30.7236 | 0.0196 |
| ptglab_ki67_111549.jpg | 4.3237 | 4.5183 | 0.1945 |
| ptglab_ki67_117470.jpg | 24.7238 | 24.1732 | 0.5506 |
| ptglab_ki67_124444.jpg | 1.9366 | 1.9358 | 0.0008 |
| leica_step14_full.jpg | 2.6157 | 2.5821 | 0.0336 |
