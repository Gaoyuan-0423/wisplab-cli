# Changelog / 更新记录

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
