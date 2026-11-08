# qPCR 实验设计 / Experimental design

样本名、Group 列或技术孔数量不能确认独立重复。默认结果是技术描述；本页 `experimentalDesign` 接口只有引擎支持且用户明确确认的 `independent` 设计可以产生组级推断。`paired`、`repeated` 可以传入以明确设计，但当前引擎不实现这两类检验，不得退回独立组检验。

Sample names, Group columns and technical-well counts do not establish independent replication. Results are descriptive by default. For `experimentalDesign`, group inference requires a supporting engine and an explicitly confirmed `independent` design. `paired` and `repeated` describe intended designs but are currently unsupported for inference; they must not fall back to independent-group tests.

## 与既有分组接口的关系 / Relationship to biologicalDesign

本页说明 `experimentalDesign`：按板号、样本、独立单位和组别显式映射，由兼容的 pcr-workbench 引擎计算。既有 `biologicalDesign` / `--groups` 接口继续支持非配对及显式配对，方法见 [生物学分组](qpcr-groups.md)。同一请求只能选择一个设计接口，不能同时提供，也不能在一个设计失败时自动切换到另一个。

This page covers the engine-owned `experimentalDesign` contract. The existing bridge-owned `biologicalDesign` / `--groups` route retains unpaired and explicit paired inference. Supply only one design per request; a failed design never switches to the other path. With neither design, `primaryAnalysis.kind` is `descriptive-only`, sample p-values are null and comparisons are empty.

`experimentalDesign` 的 `paired/repeated` 尚不支持；这不限制既有 `biologicalDesign.paired`。Excel 仍支持 `--sheet` / `importOptions.sheet` 选表，省略时默认首表；不会隐式合并多文件。

`experimentalDesign` does not yet support paired/repeated inference; the separate `biologicalDesign.paired` path remains available. Exact worksheet selection is retained; omission selects the first sheet, and files are not implicitly combined.

## CLI

在 `--config` 指定的配置中添加 `pcr.experimentalDesign`。以下仅展示结构；单位、组别、板号和样本必须依据本次实验记录确认，不能照抄示例：

Add `pcr.experimentalDesign` to the configuration selected by `--config`. This example shows structure only. Confirm unit, group, plate and sample identities from the actual experiment before use:

```json
{
  "repos": { "pcr": "/path/to/pcr-workbench" },
  "pcr": {
    "experimentalDesign": {
      "kind": "independent",
      "confirmed": true,
      "controlGroup": "Control",
      "assignments": [
        { "plate": "P1", "sample": "C1", "unitId": "U-C1", "group": "Control" },
        { "plate": "P1", "sample": "T1", "unitId": "U-T1", "group": "Treatment" }
      ]
    }
  }
}
```

```sh
wisplab pcr plate.csv --config experiment.json --ref GAPDH --control C1
```

示例每组只有一个单位，因此不能产生组间 p 值。板号不存在时用空字符串 `""`；相同样本在不同板上只有显式映射到相同 `unitId` 才能作为同一单位处理。每次使用配置前核对它仍对应当前输入。无设计配置的既有调用继续返回描述性结果。

The example contains one unit per group, so it cannot produce a group-comparison p-value. Use `""` when the source has no plate identifier. Across plates, shared sample names require explicit mapping to the same `unitId` to represent one unit. Verify that saved assignments still match the current input. Existing calls without a design continue to return descriptive results.

当前带设计的调用**只接受一个输入文件**；单表可以包含多个板号。此 runner 按文件分别分析，不把多个文件隐式合并成生物学分组。

A design-bearing call currently accepts **exactly one input file**; that table may contain several plate identifiers. This runner processes files separately and does not implicitly merge them into a biological study.

## MCP / structured JavaScript

`pcr_analyze` 和 `runPcr` 接受同一 `experimentalDesign` 对象。MCP/结构化调用必须显式传入；不会从服务器仓库配置中继承已保存的确认。

`pcr_analyze` and `runPcr` accept the same `experimentalDesign` object. Structured calls must provide it explicitly; they do not inherit a saved confirmation from server configuration.

## 结果与旧引擎 / Results and legacy engines

- `results`：样本技术描述，保留 `nTech`、来源身份以及可确定的 `nBio`；样本级 p 值和显著性始终为空。
- `groupResults`：仅确认且支持的设计下返回独立单位汇总、每组每靶标的 `nBio`/`nTech` 和适用的统计结果。
- `designStatus` / `designIssues`：确认、缺确认、无效和不支持的状态及原因。
- `inferenceMode`：实际存在组级推断结果时为 `independent_units`，否则为 `descriptive_only`。确认设计但单位不足时仍可能只有描述。
- `qcReport.replication.byTargetGroup`：每靶标每组计数。全局 `biologicalReplicateCount` 保持 `null`，不把多个靶标相加成独立样本数。

`results` contains technical descriptions and never sample-level inferential p-values. `groupResults` contains unit-level group summaries and applicable statistics only for confirmed supported designs. `designStatus` and `designIssues` explain eligibility. `inferenceMode` is `independent_units` only when group inferential results exist; otherwise it is `descriptive_only`, including confirmed designs with insufficient units. Counts are per target/group, never summed across targets into a biological n.

已锁定的旧引擎若没有新契约，桥接层返回 `unsupported`、空 `groupResults` 和明确警告，屏蔽其旧的逐孔推断输出；表达量描述保留。此兼容处理不等于旧引擎已获得实验单位归一化或组间统计能力。升级引擎后需在实际版本上重新验证，不能沿用历史 benchmark 的推断结论。

Engines without the design contract return `unsupported`, empty `groupResults` and an explicit warning. Legacy well-level inference is suppressed while expression descriptions remain. This does not retrofit unit-aware normalization or inference into older engines. Validate the actual upgraded revision separately; historical benchmarks do not establish its inferential validity.

`verify-pcr` 仍执行用户提供的外部验证脚本；旧四场景材料绑定旧计算契约，可能需要对应归档引擎。当前单位模型改变后出现不一致时，不应静默改旧期望值或恢复逐孔推断来使它通过。

`verify-pcr` still executes user-supplied external verification scripts. Historical four-scenario materials target an older contract and may require its archived engine. Do not silently change historical expectations or restore well-level inference to make them pass against the new unit model.


请求 `experimentalDesign` 而引擎不支持或设计无效时，`primaryAnalysis` 保持 `experimental-units` 错误状态；技术描述和诊断保留，CLI 返回非零、MCP 标记错误。未确认设计或独立单位不足只给可用的描述，不补造 p 值。既有锁定引擎继续用于旧路径兼容回归；新契约需要包含该实现的引擎版本，不能仅因安装了锁定引擎就宣称已支持。

An invalid or unsupported requested experimental design remains an `experimental-units` primary error with retained diagnostics; CLI exits nonzero and MCP marks the result as an error. Unconfirmed designs and insufficient units do not manufacture p-values. The existing pinned engine remains the compatibility baseline; using the new contract requires an engine revision that implements it.
