# Changelog / 更新记录

## 0.6.0 — 2026-10-31

- IHC 图像哈希绑定的参考值对照、误差与容差报告；本地厂商图复核脚本。 / Hash-bound IHC reference comparison and local vendor-image verification.

## 0.5.0 — 2026-10-30

- 显式生物学重复分组，技术孔先聚合，Welch/Holm 与追溯；单内参支持及回归。 / Explicit biological groups, well aggregation, Welch/Holm and provenance; single-reference support.

## 0.4.1 — 2026-10-30

- 固定引擎版本，新增自有合成 WB/qPCR/IHC/IF 数值回归、真实 CLI/MCP 与 CI。 / Pin verified engines and run original synthetic numerical fixtures through real engines, CLI/MCP and CI.

## 0.4.0 — 2026-10-30

- WB/qPCR/IHC/IF 自动记录输入 SHA-256、有效参数、代码修订/内容摘要、运行环境和耗时；运行前后检查变化，失败时保留记录。 / Add versioned provenance with input hashes, parameters, code fingerprints, runtime and timings; retain it on analysis failure.

## 0.3.0 — 2026-10-30

- qPCR 接入上游逐孔 QC、可选阈值、显式排除和复孔 SD 报告；默认不自动排除。 / Add engine-backed QC, optional thresholds, explicit exclusions and replicate SD reporting; default to report only.
- 标明逐孔统计与未知生物学重复数，保留 NTC 污染报告。 / Identify well-level inference and unknown biological replication; preserve NTC reporting.

## 0.2.0 — 2026-10-30

- 增加中英文 README、上手指南及四个技能的双语说明，纠正历史校准、隐私与能力边界。 / Add Chinese/English documentation and skill instructions; clarify historical calibration, privacy and interface limits.
- 修复 `--config` 执行层传递，支持配置内 `~` 与相对路径，新增 `doctor`。 / Fix configuration propagation, expand configured paths and add `doctor`.
- 修复 MCP 异步结果、EOF 和错误状态；支持 2026-07-28 发现与元数据，保留旧版协商。 / Fix asynchronous MCP calls, EOF and error status; support modern discovery/metadata and legacy negotiation.
- 完整检查 MCP 输入、对照片和验证脚本的实际路径。 / Validate actual filesystem paths for inputs, controls and verification scripts.
- qPCR 复用引擎导入器读取二进制 Excel/RDML，应用文件效率并支持显式覆盖。 / Reuse engine importers for binary Excel/RDML and preserve efficiency overrides.
- WB 拒绝无效条带和缺失对照，保留自动候选复核提示。 / Reject invalid crops and missing controls; preserve automatic-candidate review warnings.
- IHC 对照片先扣背景再标定；修复图像类型与对照文件名；报告工作分辨率；隔离本地服务并清理进程。 / Correct IHC control calibration, image types and control identity; report working resolution and manage the local server lifecycle.
- 增加回归测试与 GitHub Actions。 / Add regression tests and GitHub Actions.

[验证记录 / Verification](docs/validation-2026-10-30.md) · [Issue #1](https://github.com/Gaoyuan-0423/wisplab-cli/issues/1)
