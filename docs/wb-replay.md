# WB 固定项目重放 / Saved WB project replay

`wb-replay` 读取 WB GUI 保存的 `.realwb.zip` 项目，使用包内原图及保存的分析设置重新计算。CLI 直接调用 GUI 的 `src/real/model.ts` 项目读取、结果、描述统计和配对检验函数。

`wb-replay` reads a `.realwb.zip` archive saved by the WB GUI and recomputes from its embedded originals and saved settings. It directly calls the GUI's importer, result, descriptive-statistics and paired-test functions in `src/real/model.ts`.

```sh
wisplab wb-replay experiment.realwb.zip --config wisplab.config.json > replay.json
wisplab wb-replay first.realwb.zip second.realwb.zip --timeout-ms 600000
```

MCP 工具为 `wb_replay`，输入为 `{"files":["/absolute/path/experiment.realwb.zip"]}`；路径遵循现有 `allowPaths` 规则。API 为 `replayWbProject({files, runtime})`，配置方式与 `runWb` 相同。

The MCP tool is `wb_replay`, accepting `{"files":["/absolute/path/experiment.realwb.zip"]}` under existing `allowPaths` checks. The API is `replayWbProject({files, runtime})`, using the same configuration as `runWb`.

## 重放规则 / Replay rules

- 使用保存的 ROI、信号极性、排除/复核状态、内参配对、单位、归一化与检验选项。 / Use saved ROIs, polarity, exclusion/review states, reference pairing, units, normalization and test options.
- 不提议新泳道、不补齐缺失 ROI、不升级未复核或未确认状态。 / Never propose lanes, fill missing ROIs or upgrade review/confirmation states.
- 拒绝 `--lanes`、`--strip`、`--bg`、`--signal`、`--control` 等覆盖。需改分析时，在 GUI 修改并另存项目。 / Reject analysis overrides; edit and save a project in the GUI to change its analysis.
- 复用上游原图哈希、ROI 边界、清单、路径及大小限制校验；损坏项目保留错误，同批其他项目继续执行。 / Reuse upstream hash, ROI, manifest, archive-path and size checks; isolate invalid archives while preserving other results.
- 输入项目不被修改；导入遵循 GUI 相同的规范化规则，包括清除不可信示例标记。 / Leave input archives unchanged and apply GUI importer normalization, including removal of untrusted example markers.

仅支持真实 WB 工作区的 `blot-workbench-real` v1 项目；演示 `.wbproj.zip` 格式不支持。运行使用实际配置的引擎修订；复算历史结果还需保存当时的兼容源码和依赖，不保证不同版本之间数值完全一致。

Only `blot-workbench-real` v1 archives from the real WB workspace are supported, not demo `.wbproj.zip` archives. Replay uses the configured engine revision. Historical reproduction also requires the corresponding compatible source and dependencies; numerical identity across engine versions is not guaranteed.

## JSON 输出 / JSON output

| 字段 / Field | 内容 / Meaning |
|---|---|
| `schemaVersion` | `wisplab.wb-replay/v1` |
| `mode`, `proposalsRun` | `saved-project`, `false` |
| `files[].project` | 项目标识与原保存时间 / Project identity and saved timestamps |
| `files[].settings` | 保存并解析的设计、背景、归一化和检验设置 / Saved and resolved design, background, normalization and tests |
| `files[].images` | SHA-256、ROI、当前状态与修订；不重复原图字节或完整历史 / Hashes, ROIs, current states and revisions, without original bytes or full history |
| `files[].results` | GUI 模型逐结果数值、状态和警告 / GUI model values, statuses and warnings |
| `files[].statistics` | 描述统计及实际纳入单位 / Descriptive statistics and included units |
| `files[].pairedTests` | 配对检验、输入配对/来源或不可检验原因 / Paired tests, input pairs/sources or unavailability reasons |
| `provenance` | 包哈希、CLI/引擎修订及运行前后检查 / Archive hashes, source revisions and before/after checks |

执行成功不表示所有结果可用于推断。检查 `results[].status`、`statistics[].status`、`pairedTests[].status/quality/reason` 和警告。有效项目即使含 `draft`/`blocked` 结果，也可成功重放；损坏/读取失败则使 CLI 返回 1，MCP `isError: true`。

Execution success does not make all results eligible for inference. Inspect result/statistics statuses, paired-test status/quality/reason and warnings. Valid archives containing draft/blocked results can replay successfully; corrupt/unreadable archives produce CLI exit 1 and MCP `isError: true`.

## 数值与验证 / Numerics and validation

图像模式 `wb` 的 JSON 比值现在保留 JavaScript 双精度结果，不再先舍入到六位小数，避免很小的非零值因格式化变零。这不表示测量准确度达到全部小数位；展示端可另外格式化。

Image-mode `wb` ratios retain JavaScript double precision without prior six-decimal rounding, avoiding small nonzero values becoming zero through formatting. This does not imply measurement accuracy to all reported digits; presentation may format them separately.

```sh
npm test
npm run check
WISPLAB_CONFIG=/absolute/path/config.json node --test tests/integration/wb-precision.test.mjs tests/integration/wb-replay.test.mjs
```

定向集成用例使用锁定 WB 修订、自有合成图像和已安装 `tsx` 的 Node loader 执行生产 runner，检查手算锚点、与 GUI 纯函数输出的一致性、状态保留及错误隔离。路由由桥接测试及 CI 另行检查。此功能不增加外部留出、真实样本准确度或用户收益证据，也不补全 D08 配置历史。

Targeted integration cases execute production runners using the pinned WB engine, original synthetic images and the installed `tsx` Node loader. They check hand-calculated anchors, GUI pure-function equality, retained states and error isolation. Bridge tests and CI separately check dispatch. This adds no external holdout, real-sample accuracy or user-benefit evidence and does not implement D08 configuration history.
