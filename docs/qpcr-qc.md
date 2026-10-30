# qPCR 质控 / qPCR quality control

默认 `report`：调用 pcr-workbench 的 `computeQcFlags`，输出逐孔问题但不自动改变既有分析。数值阈值默认未启用；缺少样本、靶标或非数值 Cq 仍报告。无相对表达结果时返回逐文件错误，同时保留 QC 和 NTC 报告。

Default `report` mode runs the engine's `computeQcFlags`, reports per-well issues, and preserves the existing analysis. Numeric thresholds are disabled unless specified. Missing sample/target names and nonnumeric Cq values are still reported. Empty expression results produce a file error while retaining QC and NTC reports.

```sh
wisplab pcr plate.csv --ref GAPDH --control C1 --min-cq 10 --max-cq 35 --abs-dev 1 --z-score 2 --rep-sd 0.5
# 只有显式选择才自动排除命中逐孔规则的样本孔 / Explicit opt-in exclusion
wisplab pcr plate.csv --ref GAPDH --control C1 --max-cq 35 --qc-mode exclude
# 使用 qcReport.rows[].rowId；一次只能处理一个文件 / IDs from the report, one file at a time
wisplab pcr plate.csv --ref GAPDH --control C1 --exclude-rows 12,15
```

这些阈值仅示范语法，不是适用于所有实验的推荐值。/ These thresholds illustrate syntax; they are not universal experimental recommendations.

| CLI | MCP field | 含义 / Meaning |
| --- | --- | --- |
| `--min-cq`, `--max-cq` | `qc.minCq`, `qc.maxCq` | Cq 范围 / Cq limits |
| `--abs-dev` | `qc.absDev` | 同样本×靶标 ≥3 孔时，相对均值的绝对偏差 / Absolute deviation from group mean for ≥3 wells |
| `--z-score` | `qc.zScore` | 同上，按样本 SD 标准化 / Deviation divided by sample SD |
| `--rep-sd` | `qc.repSD` | 整组复孔 SD，只报告，不自动剔除全组 / Group SD, report only |
| `--qc-mode` | `qcMode` | `report`（默认/default）或 `exclude` |
| `--exclude-rows` | `excludeRows` | 明确选择的报告行 ID / Explicit report row IDs |

`qcReport` 包含阈值、逐孔原因、排除原因和 ID、复孔数与过滤前后 SD。行 ID 从表头后的数据矩阵起算，不保证等于 Excel 物理行号；以本次报告为准。自动排除在原始行上执行一次，不反复删除直至通过。NTC 和标准品不因自动 QC 而剔除；不允许手工剔除 NTC，以免隐藏污染记录。`report` 模式下显式 `excludeRows` 仍会生效。

`qcReport` includes thresholds, per-well reasons, exclusion IDs/reasons, replicate counts and SD before/after filtering. IDs refer to rows extracted after the detected header, not necessarily physical spreadsheet row numbers. Filtering is a single pass, never repeated until a group passes. Automatic QC does not exclude NTC or standards; manual NTC exclusion is rejected to preserve contamination evidence. Explicit `excludeRows` still applies in `report` mode.

**重复单位 / Replicate unit:** 相同样本×靶标的孔被引擎聚合；现有 p 值使用逐孔数据。报告明确标注 `statisticalUnit: well`，`biologicalReplicateCount: null`。样本标签、Group 列或技术复孔数量不能自动证明独立生物学重复；本更新没有新增生物学分组统计，也未改变上游统计算法。

Wells sharing a sample/target are aggregated; existing engine p-values use well-level values. Reports explicitly identify `statisticalUnit: well` and `biologicalReplicateCount: null`. Sample labels, a Group column or technical-well counts do not establish independent biological replication. This update does not introduce biological-group inference or change the engine's statistical algorithms.
