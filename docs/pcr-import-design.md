# qPCR 导入、配对设计与区间 / Import, paired design and intervals

单个已选内参即可进行相对定量。新增能力不要求两个内参，也不会根据孔名、Group 或 Pair 列自动假定生物学重复或配对。

One selected reference gene is sufficient for relative quantification. These features do not require two references and never infer biological replication or pairing from well names, Group or Pair columns.

## 先预览再分析 / Preview before analysis

```sh
wisplab pcr-preview instrument.xlsx --sheet 'Results' --header-row 7 \
  --columns '{"sample":"Sample Name","target":"Gene","cq":5}'

wisplab pcr instrument.xlsx --sheet 'Results' --header-row 7 \
  --columns '{"sample":"Sample Name","target":"Gene","cq":5}' \
  --ref GAPDH --control C1,C2,C3
```

`--sheet` 始终是**准确工作表名称**；`--sheet '2'` 选择名称为 `2` 的表，绝不表示第 2 张表。省略时保留首表默认行为，多表文件会给出警告。指定不存在的名称会报错并列出可选名称，不会退回首表。RDML 不接受 `--sheet`。

`--sheet` is always an **exact worksheet name**. `--sheet '2'` selects the sheet named `2`, never the second sheet. Omitting it retains the first-sheet default with a warning for multiple sheets. An unknown name fails with the available names and never falls back. RDML does not accept `--sheet`.

`--header-row` 是从 1 开始的物理行号，包含空白行。`--columns` 为 JSON 对象；必须同时提供 `sample`、`target`、`cq`，可选 `plate`、`well`、`group`、`pairId`、`task`、`quantity`。值可以是准确表头名，也可以是从 1 开始的列号。重复表头必须用列号消歧义。显式映射中省略的可选列不再自动猜测。字符串 `"5"` 是表头名称，数字 `5` 是第 5 列。

`--header-row` is a 1-based physical row number, including blank rows. `--columns` is a JSON object requiring `sample`, `target` and `cq`; optional keys are `plate`, `well`, `group`, `pairId`, `task` and `quantity`. Values are exact header names or 1-based numeric column positions. Duplicate headers require numeric positions. Optional columns omitted from an explicit mapping are not guessed. The string `"5"` is a header name; the number `5` means column 5.

共享 API 使用 `importOptions: {sheet, headerRow, columns}`。仅解析预览不需要内参、对照或分组，不运行 QC 排除或表达量推断。runner 接口通过 `mode: "preview"` 选择预览；CLI 命令为 `pcr-preview`。

The shared API uses `importOptions: {sheet, headerRow, columns}`. Parse-only preview needs no reference, control or groups and performs no QC exclusion or expression inference. The runner uses `mode: "preview"`; the CLI command is `pcr-preview`.

CLI `pcr-preview` 和 MCP `pcr_preview` 同样支持 `timeoutMs`/`--timeout-ms` 与取消；进度走 stderr 或请求指定的 MCP 进度 token。预览命令仍需配置 PCR 引擎以复用真实文件解析器。

CLI `pcr-preview` and MCP `pcr_preview` support the same `timeoutMs`/`--timeout-ms` and cancellation controls. Progress uses stderr or the requested MCP progress token. Preview still requires a configured PCR engine to use the actual file parsers.

`files[].importPreview` 返回工作表列表、实际选择、表头行、1-based 列索引和字母、完整数据行与表头前的 `preambleRows`。每行有 `sourceRow`、`analysisRowId`、`rawValues`、`parsed`、`issues`。`rawValues` 为文件读取后规范化的文本（与既有引擎一致：去首尾空白、数值保留至小数点后 10 位），不是原始文件字节。空白数据行保留在预览中，其 `analysisRowId` 为 `null`；分析继续使用原有非空数据行编号，供 `--exclude-rows` 使用。RDML 的来源行是生成表格的行号，明确标为 `RDML-generated-table-1-based`，并非 XML 文本行号。

`files[].importPreview` contains sheet names, the actual selection, header row, 1-based column indices and letters, all data rows and `preambleRows` before the header. Each row has `sourceRow`, `analysisRowId`, `rawValues`, `parsed` and `issues`. `rawValues` are reader-normalized text (matching the existing engine: trimmed strings and numbers rounded to 10 decimal places), not original file bytes. Blank data rows stay in the preview with a null `analysisRowId`; analysis retains the existing nonblank row numbering used by `--exclude-rows`. RDML source coordinates are explicitly `RDML-generated-table-1-based`, not XML line numbers.

无法自动识别列时，预览仍返回可检查的内容，`canAnalyze: false` 和 `errors` 指出需要补充的映射；正式分析会失败。缺样本名、缺靶标、非数值 Cq 和仅部分被解析的 Cq 均列入逐行 `issues` 和警告。为了兼容已有仪器导出，`21bad` 这类数值前缀仍按既有解析器读取为 `21`，但明确标记 `partially-parsed-cq`；请先核对来源，不应直接用于结果。正式分析的 `importReport` 保存同一来源映射和诊断，省略原始单元格数组。

If automatic mapping is unresolved, preview remains inspectable with `canAnalyze: false` and explanatory `errors`; analysis fails. Missing sample/target labels, nonnumeric Cq and partially parsed Cq are surfaced in row `issues` and warnings. For compatibility, a numeric prefix such as `21bad` still parses as `21` under the existing engine, but is explicitly marked `partially-parsed-cq`; inspect the source before using the result. Analysis retains the same source mapping and diagnostics in `importReport`, omitting raw cell arrays.

## 显式配对 / Explicit paired designs

```json
{
  "samples": {"C1":"Control","C2":"Control","S1":"Treatment","S2":"Treatment"},
  "controlGroup": "Control",
  "paired": true,
  "pairIds": {"C1":"Subject1","S1":"Subject1","C2":"Subject2","S2":"Subject2"}
}
```

在 `biologicalDesign` 内设置 `paired: true` 和 `pairIds`（样本名 → 配对 ID）。`pairIds` 必须准确覆盖 `samples`：不许缺样本、多样本名、空 ID 或同一组/同一对内有多个生物学样本；每个配对 ID 必须在设计中的每个组各有一个样本。配对是实验设计声明，不能因为两组样本数相同就自动建立。省略 `paired` 为非配对；非配对设计附带 `pairIds` 会报错，避免静默忽略。

Set `paired: true` and a sample-to-pair-ID `pairIds` mapping inside `biologicalDesign`. `pairIds` must exactly cover `samples`: no missing or extra sample names, empty IDs or multiple biological samples within the same group/pair. Every pair ID must have exactly one sample in each declared group. Pairing is a declaration about the experiment and is never inferred from equal group sizes. Omitting `paired` means unpaired; supplying `pairIds` without `paired: true` fails rather than ignoring it.

CLI 对应参数 / Corresponding CLI flags:

```sh
wisplab pcr plate.csv --ref GAPDH \
  --groups '{"C1":"Control","C2":"Control","S1":"Treatment","S2":"Treatment"}' \
  --control-group Control --paired \
  --pair-ids '{"C1":"Subject1","S1":"Subject1","C2":"Subject2","S2":"Subject2"}'
```

技术孔先聚合成每个生物学样本的 log2 归一化表达量。对于每个目标基因和处理/对照比较，只有双方都保留有效目标及所选内参的配对才进入推断。缺失或 QC 排除会移除该比较的整对，`pairing.omittedPairs` 列出配对 ID、双方样本名及原因；其他目标和比较独立判断。`nPairs`、`usedPairIds`、均值效应和区间均使用同一完整配对子集。增加技术孔不增加生物学 n 或配对数。

Technical wells are aggregated into one log2 normalized expression per biological sample. For each target and treatment/control comparison, inference includes only pairs with usable target and selected-reference data on both sides. Missing data or QC exclusion removes the whole pair for that comparison; `pairing.omittedPairs` records the pair ID, both samples and reasons. Other targets/comparisons are evaluated independently. `nPairs`, `usedPairIds`, the mean effect and intervals use the same complete-pair subset. More technical wells do not increase biological n or pair count.

## 效应量和 95% 区间 / Effect sizes and 95% intervals

非配对设计保留 Welch 双侧检验；配对设计使用样本内 log2 表达差的单样本 t 检验（即配对 t 检验）。`log2FoldChange` 为处理减对照，`foldChange = 2^log2FoldChange`。新增 `confidenceLevel: 0.95`、`log2FoldChangeCI95: [lower, upper]` 与 `foldChangeCI95`，后者对 log2 区间端点作指数变换。非配对标准误和自由度使用 Welch/Satterthwaite；配对使用配对差的标准误和 `nPairs - 1` 自由度。

Unpaired designs retain the two-sided Welch test. Paired designs use a one-sample t-test on within-pair log2 expression differences, equivalent to a paired t-test. `log2FoldChange` is treatment minus control and `foldChange = 2^log2FoldChange`. New fields are `confidenceLevel: 0.95`, `log2FoldChangeCI95: [lower, upper]` and `foldChangeCI95`; the latter exponentiates the log2 limits. Unpaired standard errors and degrees of freedom use Welch/Satterthwaite; paired inference uses the standard error of paired differences and `nPairs - 1` degrees of freedom.

区间是每次比较的未多重校正 95% 置信区间；p 值继续对文件内全部计划目标/组比较作 Holm 校正。因此应分别读取区间和 `pAdjusted`，不要将区间视为同时置信区间。对照自身比值为定义的基准，不提供区间。少于两个生物学样本/完整配对、零方差或无法计算统计量时，不输出虚假的 p 值或区间：相应字段为 `null` 并提供 `reason`。FC 区间超出有限浮点范围时为 `null`，log2 区间仍可使用。

Intervals are individual, unadjusted 95% confidence intervals; p-values retain Holm adjustment across every planned target/group comparison in the file. Read intervals and `pAdjusted` separately: these are not simultaneous confidence intervals. The control self-ratio is the defined reference and has no interval. Fewer than two biological samples/complete pairs, zero variance or uncomputable statistics produce null p-values/intervals with a `reason`. If exponentiating an interval exceeds the finite floating-point range, the FC interval is null while the log2 interval remains available.

计算定义参照 R 官方 [`t.test`](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/t.test.html) 和 [Student t 分布](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/TDist.html)。新增分位数通过稳定的双侧 beta 尾概率求逆；不会使用 `1 - CDF` 计算极小 p 值。上游 Welch 和 Dunnett 实现未改动。

Definitions follow R's official [`t.test`](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/t.test.html) and [Student t distribution](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/TDist.html) documentation. The new quantile solver inverts a stable two-sided incomplete-beta tail; tiny p-values do not use `1 - CDF`. Upstream Welch and Dunnett implementations are unchanged.

独立数值基准由 R 4.5.3（2026-03-11）计算，并固定在单元测试和真实引擎集成测试中，覆盖整数/非整数自由度、配对与非配对效应及双尺度区间。以下脚本可复现基准，不依赖本项目实现。

Independent numerical references were computed with R 4.5.3 (2026-03-11) and fixed in unit and real-engine integration tests, covering integer/fractional degrees of freedom, paired/unpaired effects and intervals on both scales. This script regenerates them without using the project implementation.

```r
options(digits = 17)
qt(.975, c(1, 2, 4, 9, 30, 2.4, 10000))
2 * pt(200, 18, lower.tail = FALSE)
welch <- t.test(c(1.2, 2.8, 3.1, 4.7, 6), c(.1, 1, 1.2, 1.5))
paired <- t.test(c(2, 5, 8, 10), c(1, 3, 5, 9), paired = TRUE)
for (result in list(welch, paired)) {
  print(result)
  print(result$conf.int)
  print(2 ^ result$conf.int)
}
```
