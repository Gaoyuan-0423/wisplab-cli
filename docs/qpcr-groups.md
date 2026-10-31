# 生物学重复 / Biological replicates

**单个内参即可**（例如 GAPDH），多个内参可选。生物学重复数与内参基因数是不同概念。

**One reference gene is sufficient**, such as GAPDH. Multiple references are optional. Biological replicate count and reference gene count are different quantities.

```sh
wisplab pcr plate.csv --ref GAPDH \
  --groups '{"C1":"Control","C2":"Control","T1":"Treatment","T2":"Treatment"}' \
  --control-group Control
```

MCP: `biologicalDesign: {samples: {C1: "Control", C2: "Control", T1: "Treatment", T2: "Treatment"}, controlGroup: "Control"}`. Each sample label explicitly declares one independent biological unit. Repeated technical wells must share that sample label; do not give each well a different biological ID. The input Group column is not automatically treated as an independence declaration. This mode accepts one file, using unpaired Welch by default or an explicitly declared paired design. Controls are derived from the mapping; a conflicting `--control` fails.

每个 Sample 名代表用户声明的一个独立生物学样本，技术复孔共用样本名。程序不从 Group 列猜测独立性。仅支持单文件；默认非配对 Welch，也支持显式配对 t 检验。一般重复测量模型与跨板批次校正仍不支持。对照来自映射，冲突的 `--control` 会报错。

## 显式配对 / Explicit pairing

```sh
wisplab pcr plate.csv --ref GAPDH \
  --groups '{"C1":"Control","C2":"Control","T1":"Treatment","T2":"Treatment"}' \
  --control-group Control --paired \
  --pair-ids '{"C1":"P1","T1":"P1","C2":"P2","T2":"P2"}'
```

MCP 在 `biologicalDesign` 内增加 `paired: true` 与 `pairIds`。配对 ID 必须完整覆盖声明的样本，每个 ID 在每组恰有一个样本；不从孔名、Group/Pair 列或组大小推断配对。每个靶标/比较仅保留双方都有有效靶标和所选内参的完整配对，检查 `nPairs`、`pairing.usedPairIds` 和 `pairing.omittedPairs`。缺失一侧会排除该比较的整对；技术孔不增加配对数。

In MCP add `paired: true` and `pairIds` inside `biologicalDesign`. IDs must exactly cover declared samples, with one sample per group for every ID. Pairing is never inferred from well names, Group/Pair columns or equal group sizes. Each target/comparison retains only pairs with usable target and selected-reference data on both sides; inspect `nPairs`, `pairing.usedPairIds` and `pairing.omittedPairs`. Missing one side excludes the whole pair from that comparison; technical wells do not increase pair count.

For import preview, explicit worksheet/header/column selection and full paired-design details, see [导入与配对 / Import and pairing](pcr-import-design.md).

## 主结果与失败状态 / Primary results and failure status

每个 qPCR 文件的 `primaryAnalysis` 是推荐的报告入口。显式分组成功时，`kind` 为 `biological-groups`、`statisticalUnit` 为 `biological-sample`，`summaries` 和 `comparisons` 对应生物学分组结果；不请求分组时，分别为 `well-level` 和 `well`。所有模式均先检查 `status` 与 `error`，再解读数值。

Use each qPCR file's `primaryAnalysis` as the preferred reporting entry. A successful explicit design has `kind: biological-groups` and `statisticalUnit: biological-sample`; its `summaries` and `comparisons` are the biological results. Without a design, the values are `well-level` and `well`. Check `status` and `error` before interpreting numbers in either mode.

若已请求分组，但样本映射或后续分析失败，`primaryAnalysis` 保持生物学分组的错误状态，不自动改用逐孔统计。保留的旧 `results` 和 `biologicalGroups` 是兼容/详细字段；不可将旧逐孔 p 值作为分组结论。可独立检查错误报告中的 QC/NTC 诊断。统计量为 `null` 时说明不可用，不等于“不显著”。

If a requested group design fails, the primary result remains a biological-group error and never falls back to well-level statistics. Legacy `results` and detailed `biologicalGroups` remain for compatibility/detail; do not use legacy per-well p-values as group conclusions. Available QC/NTC diagnostics can still be reviewed independently. A null statistic is unavailable, not evidence of nonsignificance.

After explicit QC, technical Cq values are averaged within each sample/target; selected reference genes are equally weighted **after applying each gene's own efficiency**. Each biological sample contributes one log2 normalized expression:

`L = -meanCq(target) * log2(1 + efficiency(target)/100) + mean_over_selected_refs(meanCq(ref) * log2(1 + efficiency(ref)/100))`.

每个自选内参必须先按自身效率换算，再取表达量的几何均值（等价于平均上述 log2 项）；不能先平均效率。单内参公式保持不变，多个内参仍为可选。推导和独立数值基准见[效率与缺失结果边界](pcr-correctness.md)。

Do not average reference efficiencies before converting Cq to quantity. One reference retains the same formula; multiple references remain optional. See [efficiency and missing-result boundaries](pcr-correctness.md) for derivation and independent numerical references.

With 100% efficiencies, L = −ΔCt. Unpaired group fold change is `2^(mean(L_group) − mean(L_control))`, with equal biological sample weights; it is a ratio of geometric means, not the legacy mean of per-well fold changes. RDML efficiencies and explicit overrides use the same precedence as normal analysis. Every selected reference must have retained data within a biological sample; incomplete samples stay listed with reasons and are omitted for that target.

先按样本聚合技术孔，再给每个生物学样本相同权重。`biologicalGroups.units` 记录可用孔数与缺失原因，`summaries` 记录实际 n 和声明 n。效率均为 100% 时在 −ΔCt 上检验；效率校正时在上述 L 上检验。旧的逐孔 `results` 保持原口径，不能与此分组统计混用。

Unpaired designs use two-sided Welch tests on per-sample L. Paired designs use a two-sided t-test on within-pair differences; fold change and inference use the same complete-pair subset. Holm adjustment includes all planned target × treatment comparisons in this file (untestable comparisons count toward the family and keep null outputs). Unpaired tests need at least two usable samples on each side; paired tests need at least two complete pairs. Insufficient data, zero paired-difference variance, or zero variance on both unpaired sides leave statistics unavailable rather than p=1. These rules concern biological sample counts, never the number of references. Technical replicates do not establish biological independence, and the mapping cannot verify the experiment's design.

每次比较返回 `confidenceLevel: 0.95`、`log2FoldChangeCI95` 与 `foldChangeCI95`。这是**单次比较、未多重校正**的 95% 区间；`pAdjusted` 另作 Holm 校正，不能把区间解释成同时置信区间。对照自身比值不提供区间，不可计算时保留 `null` 与原因。

Comparisons return `confidenceLevel: 0.95`, `log2FoldChangeCI95` and `foldChangeCI95`. These are **individual, unadjusted** 95% intervals; `pAdjusted` separately uses Holm, so the intervals are not simultaneous confidence intervals. Control self-ratios have no interval; unavailable statistics retain null values and reasons.

Method references: [NIST Welch–Satterthwaite test](https://www.itl.nist.gov/div898/handbook/eda/section3/eda353.htm), [R Holm adjustment documentation](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/p.adjust.html).

`primaryAnalysis.method` 与 `multiplicityFamilySize` 标记方法及生物学比较的校正范围。若所有计划处理/对照比较都无法产生有限的 `log2FoldChange`（例如处理样本的已选内参全部缺失或被 QC 排除、无完整配对），文件和主结果为 `error`，即使旧逐孔结果仍有对照行。QC/NTC、缺失样本和配对明细继续保留。只剩一个有效样本或完整配对但仍有有限效应量时，仍可返回描述性成功结果；不可计算的 p/CI 保持 `null`，不能解释成不显著。

The primary entry includes its method and biological multiplicity-family size. If every planned treatment/control comparison lacks a finite `log2FoldChange` (for example, all treatment references are missing or QC-excluded, or no complete pairs remain), the file and primary result are errors even if legacy control rows exist. QC/NTC, missing-sample and pairing details remain available. One usable biological sample or complete pair can still produce a successful descriptive effect; unavailable p-values and intervals remain null, not evidence of nonsignificance.
