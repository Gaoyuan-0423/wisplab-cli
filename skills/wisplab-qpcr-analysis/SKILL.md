---
name: wisplab-qpcr-analysis
description: >-
  Analyze qPCR data tables with the pcr-workbench engine: replicate pooling,
  single-reference normalization (multiple references optional), ΔΔCt (Livak)
  and Pfaffl efficiency-corrected fold change, NTC contamination reports,
  biological-group Welch/Holm and legacy well-level Welch/ANOVA + Dunnett. Use whenever the user gives you a qPCR export
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
wisplab pcr /path/to/plate.csv --ref GAPDH --control C1,C2
wisplab pcr /path/to/plate.csv --ref GAPDH --control C1 --eff "LDHA=92;GAPDH=99"
```

效率输入是百分数：92 表示 92%，不是倍率；100% 对应每周期倍率 2。RDML 声明效率会应用，显式 `--eff` 覆盖对应基因。没有提供的效率按引擎默认值处理。不要把 200 当成“标准 100% 效率”的另一种写法。
Efficiency inputs are percentages: 92 means 92%, not an amplification factor; 100% corresponds to a factor of 2 per cycle. RDML-declared efficiencies are applied, with explicit `--eff` overriding the corresponding genes. Missing efficiencies use engine defaults. Do not use 200 as another notation for standard 100% efficiency.

## 结果解读 / Interpreting results

优先读取 `files[].primaryAnalysis`，先检查 `kind`、`statisticalUnit`、`status` 与 `error`，再读取 `summaries` 和 `comparisons`。同时核对 `refGenesUsed`、`controlSamples`、`effMode`、`warnings`、`qcReport`、`ntcReport` 与逐文件 `error`。旧 `results` 保留用于逐孔诊断，不是生物学分组的默认报告入口。
Read `files[].primaryAnalysis` first: check `kind`, `statisticalUnit`, `status` and `error` before using `summaries` and `comparisons`. Also inspect `refGenesUsed`, `controlSamples`, `effMode`, `warnings`, `qcReport`, `ntcReport` and per-file `error`. Retained legacy `results` are secondary well-level diagnostics, not the default biological-group report.

| 主结果 / Primary result | 解读 / Interpretation |
| --- | --- |
| `kind: biological-groups`, `statisticalUnit: biological-sample`, `status: success` | 报告组别、靶标、生物学 n、组间 fold change、Welch p 与 Holm 校正 p。技术孔不能增加生物学 n。 / Report group, target, biological n, group fold change, Welch p and Holm-adjusted p; technical wells do not increase biological n. |
| `kind: well-level`, `statisticalUnit: well`, `status: success` | 按主结果中的逐孔统计方法解读；不称为生物学组间推断。 / Interpret the stated well-level methods; do not present them as biological-group inference. |
| `status: error` | 报告错误及仍可用的 QC/NTC 诊断，不报告失败分析的统计结论。 / Report the error and available QC/NTC diagnostics, not a failed analysis's statistical conclusions. |

若用户请求了 `biologicalDesign`，而分组失败，`primaryAnalysis` 必须保持 `kind: biological-groups` 和错误状态。**绝不能回退到旧 `results`，把逐孔 p 值当作分组 p 值。** 输出缺少 `primaryAnalysis` 时应核对版本和实际分析模式，不猜测统计单位。
If `biologicalDesign` was requested but failed, the primary result must remain `kind: biological-groups` with error status. **Never fall back to legacy `results` and present well-level p-values as group inference.** If `primaryAnalysis` is absent, verify the version and actual analysis mode rather than guessing the statistical unit.

生物学分组的 Welch 检验使用每个生物学样本的 log2 归一化表达量（效率均为 100% 时等于 −ΔCt）；Holm 校正覆盖该文件预先计划的靶标×处理组比较。旧逐孔统计中的 `pValue` 由 `statMethod` 决定：ANOVA 分支为总体检验，`pAdjusted` 为相对对照的 Dunnett 校正；不能与分组 Welch/Holm 混用。保留 `null`，不把缺失统计量写成“不显著”；极小非零 p 值使用科学计数法，不按显示精度写成 0。
Biological-group Welch tests use each sample's log2 normalized expression (−ΔCt when all efficiencies are 100%); Holm covers the planned target × treatment comparisons in that file. In legacy well-level statistics, interpret `pValue` according to `statMethod`: ANOVA is omnibus and `pAdjusted` is the Dunnett comparison to control. Do not mix those with group Welch/Holm. Preserve null values rather than calling unavailable tests nonsignificant. Display very small nonzero p-values in scientific notation instead of rounding them to 0.

如实报告内参缺失、NTC 和重复质量警告。可配置逐孔 QC、复孔 SD 报告及显式行排除，默认不自动剔除；只启用部分规则不代表全部质控通过。显式生物学分组支持单文件、非配对设计；不能把技术重复当独立生物学重复。
Report missing references, NTC findings and replicate-quality warnings accurately. Per-well QC, replicate-SD reporting and explicit exclusions are configurable; report-only is the default and partial QC is not a complete pass. Explicit biological grouping supports a single file and an unpaired design; technical replicates are not independent biological replicates.

## 验证 / Verification

保存输入、参数和引擎修订。`verify-pcr /path/to/validation` 会执行另行取得的可信 `dump_app.ts` 与 `reference_check.py`，需要对应数据、Python 环境；`grade pcr` 需要相邻的 `wisplab-benchmark` 及材料。历史通过值不可直接套用到新版本或新数据。
Record inputs, parameters, and engine revisions. `verify-pcr /path/to/validation` executes separately obtained, trusted `dump_app.ts` and `reference_check.py` and needs their data and Python environment. `grade pcr` requires the adjacent `wisplab-benchmark` and materials. Historical passing values do not automatically validate new versions or data.

计算本地运行；AI 客户端可能将工具结果或附件发送到模型服务。
Computation is local; the AI client may send tool results or attachments to its model provider.

质控参数与排除规则 / QC and exclusion policy: [说明 / Guide](../../docs/qpcr-qc.md).

生物学分组 / Biological groups: [说明 / Guide](../../docs/qpcr-groups.md).

单个内参即可进行 qPCR 分析（例如 `--ref GAPDH`）；多个内参为可选功能。 / One reference gene is sufficient (for example `--ref GAPDH`); multiple reference genes are optional.
