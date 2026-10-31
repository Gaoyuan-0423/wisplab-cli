# Changelog / 更新记录

## 0.8.1 — 2026-10-31

- 修正自选多个不同效率内参时的 qPCR 归一化，先逐基因换算再汇总；单内参继续支持，不增加数量要求。 / Correct optional multiple-reference normalization using each gene's efficiency before pooling; preserve single-reference support.
- 生物学分组没有任何可用处理/对照效应时报告错误并保留 QC/NTC 诊断；描述性效应不因缺少 p 值或区间而失败。 / Report an error when no biological treatment/control effect is available, retaining diagnostics; descriptive effects remain valid without p-values or intervals.
- worker 执行、IHC 重启和追溯固定使用同一配置快照；IHC 哈希与 Git 追溯异步化，可响应 MCP ping 与取消。 / Keep workers, IHC restarts and provenance on one configuration snapshot; make IHC hashing and Git checks asynchronous and cancellable.
- 修正大图 ROI 缩放边界的浮点溢出，报告的坐标与实际测量边界一致。 / Correct scaled ROI rounding at image boundaries so reported and measured bounds agree.
- 标注草稿保存每张图各自的审核人、日期和方法，编辑仅撤销当前图的完成状态。 / Preserve each image's reviewer, date and protocol in annotation drafts; edits invalidate only the current image's review.

## 0.8.0 — 2026-10-31

- WB 逐图错误隔离；IHC/IF 单图及整批时限、取消清理和进度；MCP 长任务不阻塞 ping/取消。 / Isolate WB image errors; bounded/cancellable analysis with progress and responsive MCP control messages.
- 按锁定修订安装引擎，doctor 区分依赖可用与干净版本验证，支持严格退出码。 / Install verified engine revisions and check them with strict doctor mode.
- IHC 导入哈希绑定 ROI/原图标尺/可选核中心，IF 选择 RGB 通道，导出本地 PNG 与 HTML 复核报告。 / SHA-bound IHC ROIs, source calibration, optional nucleus centroids, IF RGB selection, and local PNG/HTML review exports.
- PCR 选表、列映射、来源行预览；显式配对设计与非配对/配对 95% 效应区间，继续支持单内参。 / PCR sheet/column selection and source-row preview; explicit pairing and unadjusted 95% effect intervals with single-reference support.
- 独立人工核标注包（缩放、草稿、可选 H-score）及哈希绑定的核中心匹配评估；空模板保持待复核。真实人工验证需独立标注后完成。 / Independent nucleus annotation packs and spatial matching; empty templates remain pending. Real manual validation requires independently reviewed labels.

## 0.7.0 — 2026-10-31

- PCR 主结果显式标注统计单位，分组错误保留 QC/NTC，固定稳定 Welch 尾概率修订。 / Explicit PCR primary results and retained diagnostics; pin stable Welch tail evaluation.

- IHC/IF 单图失败保留整批成功结果，厂商图复核脚本保留场景错误和汇总。 / Preserve successful IHC/IF images and scene summaries across failures.
- IHC JSON 对照无需引擎配置；双语文档与 AI 技能统一单内参示例和主统计结果入口。 / Config-free offline IHC comparison; aligned single-reference and primary-result guidance.

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
