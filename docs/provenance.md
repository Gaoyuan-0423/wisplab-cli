# 分析追溯 / Analysis provenance

WB、qPCR、IHC 和 IF 的 CLI/MCP 结果自动包含 `provenance`，保存 JSON 即保存该次记录：

CLI and MCP results for WB, qPCR, IHC and IF automatically include `provenance`. Save the returned JSON to retain the record:

```sh
wisplab pcr plate.csv --ref GAPDH --control C1 > result.json
```

- `schemaVersion`、`runId`、开始/结束 UTC 时间、总耗时和运行状态。 / Schema version, run UUID, UTC timestamps, duration and status.
- 输入和对照片的 SHA-256、字节数及前后检查结果。 / Input/control SHA-256 hashes, sizes and before/after checks.
- CLI 版本、CLI/引擎 Git 修订、脏状态和源文件内容摘要。 / CLI version, bridge/engine Git revisions, dirty state and source fingerprints.
- 参数及逐文件解析后的内参、对照、效率、QC/排除行，或病理阈值/分割设置。 / Requested/defaulted options and per-file resolved references, controls, efficiencies, QC/exclusions or pathology settings.
- Node.js、操作系统和架构；检查失败的说明。 / Node.js, OS, architecture and verification warnings.

发生分析错误时，CLI 仍输出带 `error` 和追溯记录的 JSON 并返回非零退出码；MCP 返回相同记录及 `isError: true`。参数校验或配置解析失败发生在分析开始前，可能没有追溯记录。

Analysis failures retain an error/provenance JSON response with a nonzero CLI exit code or MCP `isError: true`. Invalid arguments or configuration errors before analysis starts may have no manifest.

`checks` 分别记录输入、引擎源码和桥接源码在运行前后是否一致。源码摘要包含 Git 已跟踪和未忽略的新文件；不保存文件内容。Git 不可用、路径不是独立仓库根目录、文件不可读或检测到变化时会明确标记，不能据此宣称已验证可复现。

`checks` records whether inputs, engine sources and bridge sources match before/after execution. Source fingerprints include tracked and unignored files without archiving their contents. Missing Git information, non-root repository paths, unreadable files or detected changes are explicitly reported.

**边界 / Limits:** 这是审计记录，不是输入快照或签名证明。前后相同不能排除运行中短暂修改后又还原。源码摘要不涵盖忽略的 `node_modules`、浏览器二进制、系统库或操作系统状态；依赖锁文件会进入源码摘要。脏工作区只有摘要，没有可恢复的源码归档。请另外保留原始数据、锁文件和代码版本。记录只包含文件名而非完整输入路径，但结果仍可能含敏感样本信息。

This is an audit record, not an immutable snapshot or signed attestation. Before/after equality cannot exclude transient changes that were reverted. Ignored dependencies, browser binaries and system libraries are not fingerprinted; tracked lockfiles are included. Dirty source is fingerprinted but not archived. Retain original data, lockfiles and code revisions separately. Input records expose filenames rather than absolute paths, but results can still contain sensitive sample information.

`verify-pcr` 和 `grade` 执行外部分发的验证材料，不属于本分析记录接口。 / External `verify-pcr` and `grade` workflows are outside this manifest interface.
