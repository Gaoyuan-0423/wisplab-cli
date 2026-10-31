# qPCR 效率与缺失结果边界 / Efficiency and missing-result boundaries

**单个内参足够；多个内参始终由用户自选。** 本次修复纠正用户已选多个且效率不同的参考基因的运算顺序，并修正无任何可用生物学效应时的成功状态。

**One reference gene is sufficient; multiple references remain optional.** This correction fixes the order of operations when the user selects references with different efficiencies, and the status of biological analyses with no usable treatment/control effect.

## 先按基因效率换算 / Convert using each gene's efficiency

以 `E(g) = 1 + efficiency(g)/100` 表示每周期扩增倍数。参考基因 `j` 的量与 `E(j)^(-meanCq(j))` 成比例；把这些量的几何均值用于归一化。等价的 log2 参考项为 `mean(meanCq(j) * log2(E(j)))`，不可替换为 `mean(meanCq(j)) * log2(mean(E(j)))`。这是 qBase 广义相对定量模型的运算顺序。[qBase 原始论文](https://pmc.ncbi.nlm.nih.gov/articles/PMC1852402/)

Let `E(g) = 1 + efficiency(g)/100`. Each reference quantity is proportional to `E(j)^(-meanCq(j))`; normalization uses their geometric mean. In log2 space the reference term is `mean(meanCq(j) * log2(E(j)))`, not `mean(meanCq(j)) * log2(mean(E(j)))`. This follows the generalized relative-quantification model in the [original qBase paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC1852402/).

例如，对照与处理的目标 Cq 都为 25；对照的 R1/R2 Cq 为 20/30，处理为 30/20；R1/R2 效率为 90%/110%。旧运算把平均参考 Cq 都变为 25、平均效率变为 100%，误报 FC=1。正确结果为 `1/sqrt(1.9^(-10) * 2.1^10) = 0.606277611645745`，`log2FC = -0.7219495466758747`。此例只是数值回归夹具，不是参考基因稳定性的实验建议。

For example, both groups have target Cq 25; control R1/R2 Cq are 20/30 and treatment values are 30/20, with efficiencies 90%/110%. Averaging Cq and efficiency first incorrectly gives FC 1. The correct result is `1/sqrt(1.9^(-10) * 2.1^10) = 0.606277611645745`, with `log2FC = -0.7219495466758747`. This is a numerical regression fixture, not a recommendation about reference-gene stability.

生物学结果在每样本 log2 归一化表达上继续使用 Welch 或配对 t 检验。逐孔引擎修正参考归一化，保留既有技术孔 FC 聚合和原始 ΔCt 统计口径。全部效率为 100% 的 Livak 路径不变；单内参 Pfaffl 仍适用。p/CI 不包含扩增效率估计的不确定度。

Biological inference still uses Welch or paired t tests on per-sample log2 normalized expression. The well-level engine corrects reference normalization while retaining its existing technical-well FC aggregation and raw ΔCt statistics. The all-100% Livak path and single-reference Pfaffl behavior remain supported. Reported p-values/intervals do not include uncertainty in estimated amplification efficiencies.

## 无可用效应时失败 / Fail when no effect can be computed

对于显式生物学设计，若所有计划处理/对照比较的 `log2FoldChange` 都不可用或非有限，文件、`primaryAnalysis` 和 provenance 均为错误；CLI 退出 1，MCP `isError: true`。已有对照行不代表处理比较成功。缺失目标、用户已选参考缺失、QC 排除及无完整配对的诊断仍保留，不退回逐孔推断。

For an explicit biological design, if no planned treatment/control comparison has a finite `log2FoldChange`, the file, `primaryAnalysis` and provenance are errors; CLI exits 1 and MCP sets `isError: true`. Existing control rows do not establish a successful treatment comparison. Missing-target/reference, QC-exclusion and complete-pair diagnostics remain available without falling back to well-level inference.

该判断只检查效应量，不要求 p 值或置信区间可用。一个有效处理样本或一对完整配对仍可以报告描述性效应；样本量不足时 p/CI 为 `null`。部分比较可用时，继续逐项报告缺失原因。

This status check concerns the effect, not availability of a p-value or interval. One usable treatment sample or complete pair can still yield a descriptive effect with null p/CI when replication is insufficient. If some comparisons remain usable, unavailable comparisons retain their individual reasons.

## 独立复算 / Independent reference calculation

固定期望值使用 R 4.5.3（2026-03-11），先直接在 quantity 域计算、再做 log2 与 t 检验；没有调用本项目的实现。测试覆盖生物学和逐孔结果、平均效率恰为 100% 的不同效率、非配对/配对区间、单内参缺失及 QC 全排除，以及描述性 n=1。

Fixed references use R 4.5.3 (2026-03-11), computing quantities directly before log2 transformation and t-tests, independently of this project. Tests cover biological and well-level outputs, unequal efficiencies whose mean is 100%, unpaired/paired intervals, missing or QC-excluded single-reference data, and descriptive n=1 results.

```r
options(digits = 17)
1 / sqrt(1.9^(-10) * 2.1^10)
mean(1.95^(25-c(23.9,24,24.1)) / sqrt(1.9^(-10) * 2.1^10))
target <- c(25,25.3,24.7,24,23.8,24.2)
r1 <- c(20,21,19,30,29.5,30.5)
r2 <- c(30,29,31,20,20.5,19.5)
quantity <- 1.95^(-target) / sqrt(1.9^(-r1) * 2.1^(-r2))
L <- log2(quantity)
print(L)
print(2^(mean(L[4:6])-mean(L[1:3])))
for (paired in c(FALSE, TRUE)) {
  result <- t.test(L[4:6], L[1:3], paired=paired)
  print(result)
  print(result$conf.int)
  print(2^result$conf.int)
}
```
