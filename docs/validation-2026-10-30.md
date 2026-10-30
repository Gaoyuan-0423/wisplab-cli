# 更新核查 / Update verification — 2026-10-30

关联记录 / Tracking: [Issue #1](https://github.com/Gaoyuan-0423/wisplab-cli/issues/1).

## 检查范围 / Scope

本次检查针对 CLI/MCP 桥接层及它调用的本地引擎。仓库初始 main 为 `b690858`，并无此前更新提交。三个已配置引擎均无未提交修改，其 HEAD 与核查时 `git ls-remote origin refs/heads/main` 返回的远端 main 相同：

This review covers the CLI/MCP bridge and its configured engines. The original CLI main was `b690858`, with no subsequent update commits. All three engine checkouts were clean and matched their remote main at review time:

| Engine | Verified revision |
| --- | --- |
| blot-workbench | `fd867d89fab3602ad24a2d5cb973e54577595b4e` |
| pathology-workbench | `bb9c45c0fc81fe7ea0c449d209e9d63e6eb66a2e` |
| pcr-workbench | `a0642a7b5eee6f576e3257f5c61efaabae1741ed` |

本机运行环境 / Local runtime: macOS ARM64, Node.js `24.14.1`, npm `11.11.0`.

## 回归检查 / Regression checks

`npm run check` 和 `npm test` 通过。测试使用临时目录与可控引擎替身，不需要下载实验数据或安装三个引擎，覆盖：

`npm run check` and `npm test` pass. Tests use temporary directories and controlled engine substitutes, without experimental data or the three engine installations. Coverage includes:

- CLI 无配置帮助/版本、显式和环境配置传递、相对路径、无效参数拒绝。 / Help/version without configuration, explicit/environment configuration dispatch, relative paths and invalid arguments.
- MCP 新旧协议、异步 IHC/IF 成功和失败、EOF 等待、批次错误状态。 / Modern/legacy MCP, asynchronous success/failure, draining pending calls at EOF and batch error reporting.
- MCP 对照片、目录越界、符号链接及验证脚本检查。 / Control-image, directory-boundary, symlink and verification-script checks.
- WB 条带坐标、自动候选复核警告、缺失对照拒绝。 / WB crop coordinates, candidate-review warnings and missing-control errors.
- PCR 二进制输入保真、首工作表提示、RDML 效率及显式覆盖。 / PCR binary input preservation, first-sheet warnings and RDML efficiency overrides.

CI 在 Node.js 22、24 上运行同一检查；具体执行结果以 PR 的 Checks 页面为准。 / CI runs the same checks on Node.js 22 and 24; consult the PR Checks tab for execution status.

## 真实引擎检查 / Checks against real engines

| Check | Observed result |
| --- | --- |
| qPCR CSV vs original CLI runner | Same 12 result records and warnings; numerical results unchanged |
| Same CSV converted to a real binary XLSX | Same 12 result records as CSV |
| RDML import | Parsed successfully; declared efficiency applied and explicit 92% override took precedence |
| WB public synthetic 8-bit PNG, local/full and local/crop | Net signals 64000 / 32000; ratios 1 / 0.5 |
| WB public synthetic 16-bit PNG, local/full and local/crop | Net signals 32896000 / 24672000; ratios 1 / 0.75 |
| WB rolling-ball radius 50, both synthetic bit depths | Completed with finite measurements and preserved review warnings |
| IHC synthetic H-DAB PNG, same image as test control | 400 × 300 output; background-corrected control threshold 104; control filename retained |
| IF synthetic H-DAB PNG used only as a transport fixture | Returned Pearson/Manders fields; this is a pipeline check, not an IF biological benchmark |
| MCP IHC then IF, stdin closed after requests | Both complete results returned before clean exit |
| IHC configured port occupied by an unrelated HTTP service | Rejected; zero requests sent to the unrelated service |

IHC 输入由 pathology-workbench 的 `tests/e2e/fixture.ts:createSyntheticHdabPng()` 默认参数生成。以同一合成图当作对照片只是验证标定调用路径，并不代表真实阴性对照片。CSV/RDML 材料在本机使用；未将实验或厂商图像复制进本仓库。

The IHC input was generated with the default `createSyntheticHdabPng()` fixture in pathology-workbench. Reusing it as its own control exercises calibration plumbing; it is not a biological negative control. CSV/RDML materials were used locally; no experimental or vendor images were added to this repository.

## 复现与边界 / Reproduction and limits

```sh
npm run check
npm test
node cli.mjs doctor
node cli.mjs pcr /path/to/plate.csv --ref GAPDH,ACTB --control C1,C2
node cli.mjs wb /path/to/synthetic.png --lanes 2 --control 1 --bg local
node cli.mjs ihc /path/to/synthetic-hdab.png --control-tif /path/to/synthetic-hdab.png
node cli.mjs if /path/to/synthetic-hdab.png
```

上述 `plate.csv`、内参、对照和图像路径是占位符，必须替换为与数据一致的值。`doctor` 记录实际本地修订，不执行联网更新。

These commands use placeholder paths and sample/gene names; replace them with values appropriate to your data. `doctor` reports local revisions without fetching updates.

本次没有宣称完整重跑历史 M1/M3/M4、独立 Python 校准、全部 GUI 功能、所有文件变体或所有操作系统。引擎存在的新 GUI 能力不自动等同于 CLI 已暴露该能力。qPCR 的交互式分组、孔排除、完整 QC，以及 IHC/IF 的 ROI/模型/全部参数仍以 README 的能力边界为准。

This review does not claim a full rerun of historical M1/M3/M4 validation, the independent Python calibration, every GUI feature, every file variant or every operating system. New upstream GUI capabilities are not automatically exposed through the bridge. See the README for the current interface limits.

协议更新依据 / Protocol references: [MCP versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), [MCP discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover).

## 后续集成回归 / Follow-up integration regressions

上述表格记录 0.2.0 的检查修订。0.4.1 的自动回归采用 [engines.lock.json](../engines.lock.json)；qPCR 更新到仅补齐 Linux 依赖锁的修订。合成数据、数值预期和覆盖边界见 [集成测试说明](../tests/integration/README.md)。

The table above records the 0.2.0 check. Automated regressions in 0.4.1 use the engine lock manifest, including a qPCR revision that only restores the Linux dependency lock entry. See the integration guide for fixtures, expected values and coverage limits.
