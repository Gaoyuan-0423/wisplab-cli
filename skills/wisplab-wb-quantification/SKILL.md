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

# WB 膜图定量（代理操作手册）

用户不需要学任何命令。你负责：**看图 → 构造命令 → 执行 → 把 JSON 翻译成表格**。

## 第 0 步：确认工具

```sh
which wisplab   # 有 → 直接用；没有 → node ~/Downloads/WispLab预印本验证/wisplab-cli/cli.mjs …
```

## 第 1 步：看图定条带（多面板图必做）

1. `sips -g pixelWidth -g pixelHeight <图>` 拿**原始尺寸**（Read 工具会缩放显示，坐标要按比例换算回原始像素：原始坐标 = 显示坐标 × 原宽/显示宽）。
2. 用 Read 看图，找到**目标面板**：条带行的顶部 y、每条泳道的横向范围；同时确认要排除的东西——左侧 marker 梯带列、右侧文字标注列、上下其他面板。
3. 换算出 strip 四参数：`y` = 条带行顶部 − 约 30px（留背景余量）、`h` = 条带高 + 约 60px、`x0/x1` = 最左/最右泳道边界再外扩少许。
4. 单面板、泳道清晰的图可跳过，让引擎全图自动提议（3–8 泳道自动尝试）。

## 第 2 步：构造并执行命令

| 用户说 | 追加参数 |
| --- | --- |
| "rolling ball 50" / 默认 ECL 图 | `--bg rolling:50` |
| "扣背景用局部均值" | `--bg local` |
| "泳道 1 是对照" / 不提 | `--control 1` / `--control 3` |
| "是荧光/化学发光亮带" | `--signal light` |
| 数出了 6 条泳道 | `--lanes 6`（限定后失败会如实报错，建议同时给 strip） |

```sh
wisplab wb "<图>" --strip "y,h,x0,x1" --lanes 6 --bg rolling:50
```

⚠ 该引擎按导入策略**只收 TIFF/PNG**；用户给 JPG 时先 `sips -s format tiff 图.jpg --out 图.tif` 再喂，并向用户说明一句。

## 第 3 步：结果呈现（不要倒 JSON）

读输出 JSON 的 `images[0].lanes[]`，给用户这样的表：

| 泳道 | 净信号 net | 相对对照 |
| --- | --- | --- |
| 1（对照） | 173,214 | 1.000 |
| 2 | 2,712 | 0.016 |

- `net` = 扣背景后的条带信号总量（dark 图：面积×背景均值 − 条带和）；`ratio` = net ÷ 对照泳道 net。
- **warnings 必须翻译**：`CLIPPED_PIXELS`＝条带里有饱和像素（定量偏低）；`NON_POSITIVE_NET`＝该泳道无有效信号（检查条带框是否框错/泳道是空孔）；`BAND_TOUCHES_EDGE`＝条带框贴边。
- 提醒一句：比值只有相对意义，跨膜比较需各自内参。

## 参数语义（AI 自查用）

`--strip y,h,x0,x1`：h 要含条带两侧背景余量；x 范围若含梯带/文字列，列剖面会混入干扰导致提议失败——报错"泳道提议失败"时先收窄 x 范围重试，再考虑降泳道数。`--bg rolling:半径` 与 ImageJ Subtract Background 像素级一致；`--bg local` 用背景矩形均值，两者数值不可互比。

## 兜底与验证

- CLI 不可用：直接 tsx 引擎（blot-workbench 仓库 AGENTS.md 有完整配方与禁忌）。
- 用户要求验证数字：`wisplab grade wb <提交.json>`（期望值基准，通过线 net ≤1%）；rolling ball 对 ImageJ 的像素级 parity 记录在仓库 `docs/validation-real-images.md`。
- 厂商图（CST/Proteintech 等）仅本机使用，结果数字可外发，图片与叠加图不外发。
