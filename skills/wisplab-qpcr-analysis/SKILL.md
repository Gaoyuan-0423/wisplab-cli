---
name: wisplab-qpcr-analysis
description: >-
  Analyze qPCR data tables with the pcr-workbench engine: replicate pooling,
  multi-reference-gene normalization, ΔΔCt (Livak) and Pfaffl
  efficiency-corrected fold change, NTC contamination report, group statistics
  (Welch t, ANOVA + Dunnett). Use whenever the user gives you a qPCR export
  (QuantStudio/CFX/LightCycler CSV, 仪器导出表格) or asks about 相对定量/ΔΔCt/
  2^-ΔΔCt/Pfaffl/效率校正/内参/对照孔/NTC/熔解QC/组间统计/显著性 — even without
  saying "WispLab". You (the agent) construct and run the wisplab pcr command
  yourself; the user never needs CLI syntax. Not for Western blot or histology
  image quantification.
---

# qPCR 相对定量分析（代理操作手册）

用户不需要学任何命令。你负责：**问清两件事 → 执行 `wisplab pcr` → 把结果翻译成生物学结论**。

## 第 0 步：确认工具与输入

```sh
which wisplab || node ~/Downloads/WispLab预印本验证/wisplab-cli/cli.mjs
```

输入是仪器导出表（QuantStudio/CFX/LC480 的 CSV/TXT 均可，含元数据头也能自动识别表头行）。

## 第 1 步：必须先问清（或从上下文确认）

1. **内参基因叫什么**（Target 列里的名字，如 GAPDH、ACTB；可多个，会自动池化）。
2. **哪些样本是对照组**（Sample 列里的准确名字，如 C1、KYOU-D0；可多个，会合并池化）。

## 第 2 步：执行

| 用户说 | 参数 |
| --- | --- |
| "GAPDH 和 ACTB 做内参" | `--ref GAPDH,ACTB` |
| "C1、C2 是对照" | `--control C1,C2` |
| "LDHA 引物效率 200%" / "效率 92%" | `--eff "LDHA=200"`（百分制；全部默认 100 = Livak） |

```sh
wisplab pcr "<表>" --ref GAPDH,ACTB --control AiW002-2-D0,KYOU-D0
```

## 第 3 步：结果解读（给生物学结论，不要倒 JSON）

读 `files[0].results[]`，每条是「样本 × 目标基因」：

| 字段 | 呈现方式 |
| --- | --- |
| `foldChange` | 相对对照的表达倍数（>1 上调，<1 下调）——**主结果** |
| `deltaCt` / `ddCt` | 方法中间量（Pfaffl 模式下 ddCt 无意义，别展示） |
| `pValue` / `pAdjusted` | p 值与 Dunnett 校正后 p（vs 对照）；statMethod 注明用了哪种检验 |
| `effMode` / statMethod 含 "Pfaffl" | 提醒用户已做效率校正 |

结论句式：「相对对照，CAMK2A 在 AiW002-2-D7 中表达 5.05 倍（Dunnett 校正 p=7.2e-4，**）；GRIN1 26.7 倍（p=3.2e-4，**）」。

**必须翻译的警告**：
- `warnings` 里「内参未检出」「NTC 提前扩增」＝该基因/该板结果不可信，如实告知；
- `NON_POSITIVE_NET` 不适用本模块；PCR 侧注意「Task=NTC 或样本名 NTC 开头」的孔会被自动剔除。

## 用户要验证数字时

两种方式：(a) `wisplab verify-pcr`——对真实 QuantStudio 导出跑 4 场景独立参考比对（Livak/Pfaffl ≤1e-09、统计 ≤1e-08、深尾部 Dunnett 回归）；(b) 用户拿到别处（如 AI 自己写的脚本）算的 fold change → 整理成 `[{target, sample, foldChange}]` 后 `wisplab grade pcr <提交.json>` 评分。

## 兜底

CLI 不可用：tsx 直调仓库引擎（pcr-workbench 仓库 AGENTS.md 有完整配方；⚠ stats.ts 的 Dunnett 求积已修复，不要回退旧实现）。
