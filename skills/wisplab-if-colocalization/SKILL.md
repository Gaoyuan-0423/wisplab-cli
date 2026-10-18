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

# IF 共定位定量（代理操作手册）

用户不需要学任何命令。你负责：**执行 `wisplab if` → 把共定位系数翻译成解读**。

## 第 0 步：确认工具

```sh
which wisplab || node ~/Downloads/WispLab预印本验证/wisplab-cli/cli.mjs
```

首次运行自动起停 vite（最多约 15 秒）。

## 第 1 步：执行

```sh
wisplab if "<双染图>"
```

默认 **R 通道 vs G 通道**、逐通道背景 5% 百位 + Otsu 自动阈值。

## 第 2 步：通道核对（执行前必须和用户确认一次）

看一眼图或问用户：「两种荧光分别是哪两个颜色/通道？」常见映射：

| 用户说 | 通道 |
| --- | --- |
| 红 + 绿（最常见） | R vs G（默认，直接跑） |
| 红 + 远红（伪彩显示为蓝/青） | 可能是 R vs B —— 当前引擎固定 R/G，需说明限制 |
| 图是伪彩合成/三通道以上 | 说明：引擎取 R、G 两通道，其余通道是串扰源，解读时要声明 |

## 第 3 步：结果解读（给解读，不要倒 JSON）

读 `files[0].coloc`：

| 字段 | 含义与解读句式 |
| --- | --- |
| `pearsonAll` | 全图逐像素 Pearson，−1–1。「两通道整体相关 r=0.62」 |
| `pearsonMasked` | 双通道均过阈值区域内的相关——弱弥散样本下可能比 all 更低甚至为负，**这是阈值化后子集的性质，不是错误** |
| `mandersM1` | A 通道信号中与 B 重叠的比例（0–1）「48.6% 的红信号与绿共定位」 |
| `mandersM2` | 反向同理「46.5% 的绿信号与红共定位」 |

结论句式：「红（CD20）与青（CD3）整体 Pearson r=0.11，重叠有限；Manders M1=0.49、M2=0.46，说明两 marker 各自约一半信号与对方空间重叠——部分共定位而非完全共定位。」

**不要**：把 M1/M2 平均成一个"共定位系数"；在无阈值背景差异大的图上直接报全图 Pearson；忘记声明所用通道。

## 兜底与验证

- CLI 不可用：vite dev + Playwright 动态 import `analyzeColocImage`（pathology-workbench 仓库 AGENTS.md）。
- 已知参考：CD20-CD3 扁桃体双染 Pearson(all)=0.108、M1=0.486、M2=0.465（`~/Downloads/IHC测试图/results_m3/if/`）。
- 厂商图仅本机；系数数字可外发。
