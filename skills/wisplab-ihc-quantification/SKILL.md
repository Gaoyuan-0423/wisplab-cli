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

# IHC／染色定量（代理操作手册）

用户不需要学任何命令。你负责：**执行 `wisplab ihc` → 把 JSON 翻译成结论文**。

## 第 0 步：确认工具

```sh
which wisplab || node ~/Downloads/WispLab预印本验证/wisplab-cli/cli.mjs
```

首次运行会自动起停 vite（最多约 15 秒），属正常；端口冲突在
`~/Downloads/WispLab预印本验证/wisplab-cli/wisplab.config.json` 改 `ihc.devPort`。

## 第 1 步：选预设

| 用户说 | 参数 |
| --- | --- |
| 免疫组化 / DAB 棕色 / IHC | `--profile h_dab`（默认） |
| 苏木精伊红 / H&E / HE | `--profile h_eosin` |
| Masson / 三色 / 胶原蓝 | `--profile masson` |

```sh
wisplab ihc "<图>" [--profile 预设]
```

接受 JPG/TIFF/PNG（1024px 以上效果最好；16 位 TIFF 直接支持）。

## 第 2 步：有对照片时必须用

用户给了未染色/阴性对照片：

```sh
wisplab ihc "<样本>" --control-tif "<对照片>"
```

阈值改为按对照片 0.1% 假阳率标定——**弥漫背景或弱样本必须用这个**，否则整图 Otsu 会把背景计成阳性。对照片格式需 TIFF。

## 第 3 步：结果解读（给结论，不要倒 JSON）

读 `files[0]`：

| 字段 | 呈现方式 |
| --- | --- |
| `overall.positiveFraction` | 阳性面积 X.X%（目标蛋白表达/染色面积占比） |
| `overall.hScore` | H-score 0–300（膜/质标记的临床惯用读出；核标记也可用） |
| `overall.positiveNuclei / totalNuclei` | 阳性核 X / Y |
| `overall.labelingIndex` | 标注指数（**只对核标记有意义**，膜标记如 CD20/HER2 请引导用户看 H-score） |
| `thresholdUsed` + 背景值 | 实际生效阈值 |
| `qc.otsuSeparation` | <0.35 时必须提示"直方图无双峰，阈值不可靠，建议对照片标定" |

结论句式示例：「该图 DAB 阳性面积 12.3%，H-score 85（弱-中等），检出 1,240 个核中 18.2% 呈阳性」。

## 体检建议（主动给）

- `warnings` 含阈值/饱和/组织占比提示时逐条翻译成建议（如"建议对照片标定""降低曝光重扫"）。
- 弥漫性胞质背景会让整图阳性面积与 LI 偏高——此时强调核级指标（阳性核数/H-score）或建议对照片标定。
- 绝对密度（个/mm²）需图像带标尺标定 μm/px；官网缩略图没有标尺，不要编造密度。

## 兜底与验证

- CLI 不可用：vite dev + Playwright 动态 import 引擎（pathology-workbench 仓库 AGENTS.md 有完整配方与禁忌：整图定阈、Ruifrok 求逆法、H-score 语义）。
- 用户要求验证数字：`wisplab grade ihc <提交.json>`（10 ROI 基准，通过线 ≤2.5pp；同解码器下实际 ≤0.6pp）。
- 厂商图仅本机；结果数字可外发。
