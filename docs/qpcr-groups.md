# 生物学重复 / Biological replicates

**单个内参即可**（例如 GAPDH），多个内参可选。生物学重复数与内参基因数是不同概念。

**One reference gene is sufficient**, such as GAPDH. Multiple references are optional. Biological replicate count and reference gene count are different quantities.

```sh
wisplab pcr plate.csv --ref GAPDH \
  --groups '{"C1":"Control","C2":"Control","T1":"Treatment","T2":"Treatment"}' \
  --control-group Control
```

MCP: `biologicalDesign: {samples: {C1: "Control", C2: "Control", T1: "Treatment", T2: "Treatment"}, controlGroup: "Control"}`. Each sample label explicitly declares one independent biological unit. Repeated technical wells must share that sample label; do not give each well a different biological ID. The input Group column is not automatically treated as an independence declaration. This mode accepts one file and an unpaired design. Controls are derived from the mapping; a conflicting `--control` fails.

每个 Sample 名代表用户声明的一个独立生物学样本，技术复孔共用样本名。程序不从 Group 列猜测独立性。仅支持单文件、非配对设计；配对、重复测量、跨板批次校正不在此模式内。

After explicit QC, technical Cq values are averaged within each sample/target; selected reference means are equally weighted. Each biological sample contributes one log2 normalized expression:

`L = -meanCq(target) * log2(1 + efficiency(target)/100) + meanReferenceCq * log2(1 + meanReferenceEfficiency/100)`.

With 100% efficiencies, L = −ΔCt. Group fold change is `2^(mean(L_group) − mean(L_control))`, with equal biological sample weights; it is a ratio of geometric means, not the legacy mean of per-well fold changes. RDML efficiencies and explicit overrides use the same precedence as normal analysis. Every selected reference must have retained data within a biological sample; incomplete samples stay listed with reasons and are omitted for that target.

先按样本聚合技术孔，再给每个生物学样本相同权重。`biologicalGroups.units` 记录可用孔数与缺失原因，`summaries` 记录实际 n 和声明 n。效率均为 100% 时在 −ΔCt 上检验；效率校正时在上述 L 上检验。旧的逐孔 `results` 保持原口径，不能与此分组统计混用。

Two-sided Welch tests compare each treatment against control on per-sample L. Holm adjustment includes all planned target × treatment comparisons in this file (untestable comparisons count toward the family and keep null outputs). Each side needs at least two usable biological samples for a p-value; otherwise it remains null. When both variances are zero, statistics are unavailable, not p=1. These rules concern biological sample counts, never the number of references. Technical replicates do not establish biological independence, and the mapping cannot verify the experiment's design.

Method references: [NIST Welch–Satterthwaite test](https://www.itl.nist.gov/div898/handbook/eda/section3/eda353.htm), [R Holm adjustment documentation](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/p.adjust.html).
