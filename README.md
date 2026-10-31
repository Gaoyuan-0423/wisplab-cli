# wisplab-cli

**中文** | [English](README.en.md) · [上手指南](GETTING-STARTED.md) · [Getting started](GETTING-STARTED.en.md)

WispLab 的本地命令行与 MCP 接口，用于 **Western blot、IHC/组织染色、IF 双通道共定位和 qPCR** 分析。它调用你配置的三个 WispLab 仓库中的分析代码，让脚本和 AI 助手使用同一套引擎，并输出 JSON 结果。

**English:** A local CLI and MCP interface for Western blot, histology, immunofluorescence colocalization, and qPCR analysis, powered by the configured WispLab engine repositories. [Read the full English documentation →](README.en.md)

## 能做什么

| 命令 | 引擎 | 当前接口提供的能力 |
| --- | --- | --- |
| `wb` | [blot-workbench](https://github.com/Gaoyuan-0423/blot-workbench) | PNG/TIFF 泳道提议、指定条带范围、局部或 rolling-ball 背景扣除、亮/暗信号、相对对照泳道的净信号比值 |
| `ihc` | [pathology-workbench](https://github.com/Gaoyuan-0423/pathology-workbench) | H-DAB、H&E、Masson 整图及哈希绑定 ROI；阳性面积、核计数/H-score、mpp 标尺、核中心导出、本地 PNG/HTML 复核；H-DAB 阴性对照片标定 |
| `if` | 同上 | 可选两个不同 RGB 通道（默认 R/G）的 Pearson、阈值后 Pearson、Manders M1/M2 和本地叠加图 |
| `pcr` | [pcr-workbench](https://github.com/Gaoyuan-0423/pcr-workbench) | 可选工作表/表头/列映射；单内参归一化（多内参可选）、ΔΔCt/Pfaffl、QC/NTC、显式非配对/配对分组与单次比较 95% 区间 |
| `pcr-preview` | 同 qPCR 引擎 | 只解析工作表、来源行、列映射与问题，不运行表达量推断 |
| `ihc-annotation-pack` / `ihc-nuclei-validate` | 离线本地工具 | 原图人工标注包、可恢复草稿、一对一核中心匹配与可选独立 H-score 误差 |
| `ihc-validate` | 离线 JSON 对照 | 按图像哈希匹配已有分析和参考值；比较核数、H-score、阳性面积，无需引擎配置 |
| `doctor` | 本地环境 | 依赖 `ready` 与锁定修订 `verified` 分开报告；`--strict` 未验证时失败 |

CLI 与 MCP 共用 `lib.mjs`。WB/qPCR 由对应仓库的 `tsx` 运行；IHC/IF 通过本地 Vite 和 Playwright Chromium 调用浏览器引擎。**桥接包本身没有 npm 运行依赖**，但三个引擎及 Chromium 必须单独安装。运行的是本地配置的修订，更新本仓库不会自动更新引擎。

## 快速开始

需要 Git、Node.js ≥ 22.12，以及三个引擎所要求的运行环境。完整依赖安装与 AI 客户端设置见[上手指南](GETTING-STARTED.md)。

```sh
git clone https://github.com/Gaoyuan-0423/wisplab-cli.git
cd wisplab-cli
node scripts/setup-engines.mjs --root ../wisplab-verified-engines --config ./wisplab.config.json
node cli.mjs doctor --strict
node cli.mjs --help
npm link                 # 可选：启用 wisplab 命令
```

```sh
# WB：6 泳道，手工选定目标面板范围，以泳道 1 为对照
wisplab wb blot.png --strip "140,85,160,350" --lanes 6 --bg rolling:50 --control 1

# qPCR：先检查解析；内参和对照名称必须与数据表一致
wisplab pcr-preview plate.csv
wisplab pcr plate.csv --ref GAPDH --control C1,C2
wisplab pcr plate.csv --ref GAPDH --control C1 --eff "LDHA=92;GAPDH=99"

# IHC：对照片标定限 H-DAB；导出核中心和本地复核图
mkdir -p ./reviews
wisplab ihc section.tif --profile h_dab --nuclei --review-dir ./reviews
wisplab if duplex.png --channels R,B --review-dir ./reviews

# 已有 IHC 分析和参考值的离线比较；无需配置或安装引擎
wisplab ihc-validate result.json reference.json
```

安装脚本读取 `engines.lock.json`，在新目录安装固定修订及依赖，并创建新配置；已有目录或配置不会被覆盖。已有引擎可继续手工配置，详见[固定版本安装](docs/verified-engines.md)。

`--strip y,h,x0,x1` 使用原图像素坐标，`h` 为高度，`x1` 为右边界；选区应保留背景余量并排除 marker、文字和其他面板。`--control` 对 WB 是从 1 开始的泳道号，对 qPCR 是逗号分隔的样本名。逐文件分析错误会使 CLI 退出码为 1，MCP 返回 `isError: true`，同时保留 JSON 结果。即使执行成功，也应检查 `warnings`。

## 配置

配置优先级：`--config <path>` → `WISPLAB_CONFIG` → 当前目录的 `wisplab.config.json` → CLI 目录的同名文件。显式指定的配置不存在时会报错。配置中的 `repos` 和 `allowPaths` 支持 `~`；相对路径以配置文件所在目录为基准。

```json
{
  "repos": {
    "wb": "../blot-workbench",
    "ihc": "../pathology-workbench",
    "pcr": "../pcr-workbench"
  },
  "ihc": { "devPort": 5173 },
  "allowPaths": ["~/data", "/tmp"]
}
```

`allowPaths` 限制 **MCP 输入和图像复核输出目录**，包括对照片和验证材料；校验解析符号链接后的实际路径。CLI 是直接执行的本地命令，不套用这层 MCP 限制。IHC/IF 启动的 Vite 只监听 `127.0.0.1`；端口冲突时修改 `ihc.devPort`。

## MCP 与 AI 技能

`ihc-validate` 是独立的本地 CLI 命令，不读取 `wisplab.config.json` 或 `WISPLAB_CONFIG`。其 `ungraded` 状态仅表示比较完成，不能视为验证通过。

六个工具：`wb_quantify`、`ihc_quantify`、`if_colocalize`、`pcr_preview`、`pcr_analyze`、`pcr_verify`。使用 stdio 传输；IHC/IF 调用会等待分析完成后返回结果。支持 2026-07-28 的 `server/discover` 与请求元数据，并保留旧客户端的 `initialize` 协商。

```json
{
  "mcpServers": {
    "wisplab": {
      "command": "node",
      "args": ["/path/to/wisplab-cli/mcp-server.mjs", "--config", "/path/to/wisplab.config.json"]
    }
  }
}
```

仓库的 [`skills/`](skills/) 提供四个可选 AI 技能。安装方法见[上手指南](GETTING-STARTED.md)。AI 助手可以把自然语言转换成命令，但仍需正确的内参、对照、图像通道和实验设计信息。

分析计算在本机执行；AI 客户端可能把工具返回的结果、提示词或你附加的图像发送给模型服务商。MCP 路径限制并不控制客户端的数据传输，请按所用客户端的设置管理这些内容。

## 核查、更新与复现

0.8 能力与限制见下方专题指南和 [CHANGELOG](CHANGELOG.md)；[2026-10-30 核查报告](docs/validation-2026-10-30.md) 保留为历史记录。真实人工 IHC 准确性验证仍待独立标注完成，不能用合成测试或厂商图回归替代。

```sh
npm test
npm run check
wisplab doctor > environment.json
```

`doctor` 区分依赖可用性 `ready` 和匹配干净锁定修订的 `verified`；`doctor --strict` 要求后者。它不联网判断“是否最新”，也不代替科学算法验证。更新引擎前保存当前 Git 修订和输入/参数，阅读对应仓库的变更；更新后重新安装其锁定依赖，再执行诊断和自己的参考数据回归。

最初 README 中的 2026-10-18 M1/M3/M4 数字是历史验证记录，依赖特定数据、参数和引擎版本，不能作为当前任意版本全部通过校准的证明。本仓库的自动化测试验证桥接行为；科学数值一致性应结合固定输入和对应引擎的验证材料重新检查。

`wisplab verify-pcr /path/to/validation` 需要另行获取可信的 `dump_app.ts`、`reference_check.py`、相应数据和 Python 环境；它会执行这些脚本。`wisplab grade <pcr|ihc|wb|synthetic16> submission.json` 需要旁边的 `../wisplab-benchmark/grade.mjs` 及其基准材料。它们均不包含在本仓库内。

## 当前边界

- WB 输出相对指定泳道的比值，不自动完成目标蛋白/上样内参的双重归一化。需要原始 PNG/TIFF；JPEG 转成 TIFF 不能恢复压缩时丢失的信息。
- IHC 支持从清单导入原图像素矩形 ROI、`--mpp` 和 `--nuclei`；未暴露全部分割设置或模型选择。IF 仍为整图，不支持 ROI。核强度 H-score 不是通用临床评分；没有可信 mpp 时不能解释每 mm² 密度。
- 病理引擎对超过 4096 像素边长的图像降采样，16 位 TIFF 转为 8 位工作像素；WB 的 8/16 位图像流程与此不同。
- IF 用 `--channels R,B` 等参数选择两个不同 RGB 通道，默认 R/G；不提供任意光谱通道或手工阈值。伪彩图需核实实际通道含义。
- qPCR 显式分组仍限单文件；非配对用 Welch，显式 `--paired --pair-ids` 用完整配对的 t 检验，不推断配对、不提供一般重复测量模型或跨板校正。95% 区间未作多重校正，p 值另作 Holm 校正。优先解读 `primaryAnalysis`；分组失败不得回退到逐孔统计。Excel 可按名称选表，省略时默认首表，不自动合并。
- IHC/IF 可导出本地 PNG、HTML 和结果 JSON；叠加显示阳性染色/通道信号，不是核轮廓。WB 复核图仍使用上游界面。原图点选标注包目前支持 PNG/JPEG，TIFF 须使用符合坐标/哈希规范的外部标注流程。空间比较不提供 Dice/IoU；`compared` 只表示比较完成，不表示精度达标。

分析默认整批时限 5 分钟，IHC/IF 单图 2 分钟，可用 `--timeout-ms` / `--file-timeout-ms` 调整。进度写 stderr；MCP 仅在请求提供进度 token 时通知，支持取消且 `ping` 保持响应。超时、部分失败与清理边界见[运行控制](docs/runtime-controls.md)。

问题与变更通过 [Issues](https://github.com/Gaoyuan-0423/wisplab-cli/issues) 和 [Pull requests](https://github.com/Gaoyuan-0423/wisplab-cli/pulls) 记录。许可证见 [LICENSE](LICENSE)。

质控参数与排除规则 / QC and exclusion policy: [说明 / Guide](docs/qpcr-qc.md).

分析追溯 / Analysis provenance: [格式与边界 / Format and limits](docs/provenance.md).

真实引擎回归 / Real-engine regression: [安装、固定版本与合成数据 / Setup, pinned revisions and fixtures](tests/integration/README.md).

单个内参即可进行 qPCR 分析（例如 `--ref GAPDH`）；多个内参为可选功能。 / One reference gene is sufficient (for example `--ref GAPDH`); multiple reference genes are optional.

生物学分组 / Biological groups: [Guide](docs/qpcr-groups.md).

IHC 参考值与本地厂商图复核 / Reference comparisons and local vendor checks: [Guide](docs/ihc-validation.md).

0.8 使用说明 / 0.8 guides: [导入与配对 / Import and pairing](docs/pcr-import-design.md) · [图像 ROI 与复核 / Image review](docs/image-review.md) · [独立核标注 / Independent annotations](docs/ihc-nuclei-validation.md) · [时限与取消 / Runtime controls](docs/runtime-controls.md) · [锁定引擎安装 / Verified engines](docs/verified-engines.md).
