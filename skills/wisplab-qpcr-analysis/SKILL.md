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

# qPCR 相对定量 / Relative qPCR analysis

使用 `wisplab pcr` 或 MCP `pcr_analyze`。以实际解析和统计输出为准，不自行猜测缺少的实验设计。
Use `wisplab pcr` or MCP `pcr_analyze`. Base the report on actual parsing and statistical output; do not invent missing experimental design.

## 环境与输入 / Setup and inputs

运行 `wisplab doctor`；没有全局命令时使用 `node /path/to/wisplab-cli/cli.mjs doctor`。需要配置的 PCR 仓库及其 `tsx` 与依赖。
Run `wisplab doctor`, or `node /path/to/wisplab-cli/cli.mjs doctor` at the installed location. The configured PCR repository, its `tsx`, and dependencies are required.

复用上游导入器，支持 CSV/TXT/TSV（UTF-8/GBK）、Excel（XLSX/XLS/XLSM/XLSB）、RDML。Excel 只取首个工作表，多工作表有警告；不要声称自动合并所有工作表。
The upstream importer supports CSV/TXT/TSV (UTF-8/GBK), Excel (XLSX/XLS/XLSM/XLSB), and RDML. Excel uses only the first worksheet, with a warning for multiple sheets; do not claim all worksheets are merged.

## 实验信息与执行 / Experimental details and execution

从已有上下文确认内参基因、对照样本准确名称，以及技术/生物学重复如何编码。仅缺少必要信息时询问。不要把自动默认内参或对照当成用户确认的设计。
Establish exact reference-gene and control-sample names, and how technical/biological replicates are encoded, from existing context. Ask only for missing essentials. Do not treat automatically chosen defaults as a user-confirmed design.

```sh
wisplab pcr /path/to/plate.csv --ref GAPDH,ACTB --control C1,C2
wisplab pcr /path/to/plate.csv --ref GAPDH --control C1 --eff "LDHA=92;GAPDH=99"
```

效率输入是百分数：92 表示 92%，不是倍率；100% 对应每周期倍率 2。RDML 声明效率会应用，显式 `--eff` 覆盖对应基因。没有提供的效率按引擎默认值处理。不要把 200 当成“标准 100% 效率”的另一种写法。
Efficiency inputs are percentages: 92 means 92%, not an amplification factor; 100% corresponds to a factor of 2 per cycle. RDML-declared efficiencies are applied, with explicit `--eff` overriding the corresponding genes. Missing efficiencies use engine defaults. Do not use 200 as another notation for standard 100% efficiency.

## 结果解读 / Interpreting results

读取 `files[].results`，并核对 `refGenesUsed`、`controlSamples`、`effMode`、`warnings`、`ntcReport` 与逐文件 `error`。展示样本、基因、`foldChange`、适用的 p 值及 `statMethod`；保留 `null`，不把缺失统计量写成不显著。
Read `files[].results` and check `refGenesUsed`, `controlSamples`, `effMode`, `warnings`, `ntcReport`, and per-file `error`. Report sample, gene, `foldChange`, applicable p-values, and `statMethod`. Preserve `null`; do not interpret unavailable statistics as nonsignificance.

`pValue` 的含义由 `statMethod` 决定：ANOVA 分支是总体检验，`pAdjusted` 才是相对对照的 Dunnett 校正结果；Welch 分支报告相应比较。效率校正影响 fold change，不应自行声称所有统计也自动改用效率校正后的表达量。
Interpret `pValue` according to `statMethod`: under ANOVA it is the omnibus test, while `pAdjusted` is the Dunnett-adjusted comparison to control; the Welch branch reports its comparison. Efficiency correction affects fold change; do not claim all tests automatically operate on efficiency-corrected expression.

如实报告内参缺失、NTC 和重复质量警告。当前桥接接口不提供上游界面的交互式分组或全部上游设置；可配置逐孔 QC、复孔 SD 报告及显式行排除，默认不自动剔除；只启用部分规则不代表全部质控通过。不要把技术重复当独立生物学重复来扩大结论。
Report missing references, NTC findings, and replicate-quality warnings accurately. The bridge does not expose interactive grouping or every upstream setting; Configurable per-well QC, replicate-SD reporting and explicit exclusions are available; report-only is the default. Do not treat technical replicates as independent biological replicates to broaden conclusions.

## 验证 / Verification

保存输入、参数和引擎修订。`verify-pcr /path/to/validation` 会执行另行取得的可信 `dump_app.ts` 与 `reference_check.py`，需要对应数据、Python 环境；`grade pcr` 需要相邻的 `wisplab-benchmark` 及材料。历史通过值不可直接套用到新版本或新数据。
Record inputs, parameters, and engine revisions. `verify-pcr /path/to/validation` executes separately obtained, trusted `dump_app.ts` and `reference_check.py` and needs their data and Python environment. `grade pcr` requires the adjacent `wisplab-benchmark` and materials. Historical passing values do not automatically validate new versions or data.

计算本地运行；AI 客户端可能将工具结果或附件发送到模型服务。
Computation is local; the AI client may send tool results or attachments to its model provider.

质控参数与排除规则 / QC and exclusion policy: [说明 / Guide](../../docs/qpcr-qc.md).

单个内参即可进行 qPCR 分析（例如 `--ref GAPDH`）；多个内参为可选功能。 / One reference gene is sufficient (for example `--ref GAPDH`); multiple reference genes are optional.
