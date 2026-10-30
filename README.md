# wisplab-cli

**中文** | [English](README.en.md) · [上手指南](GETTING-STARTED.md) · [Getting started](GETTING-STARTED.en.md)

WispLab 的本地命令行与 MCP 接口，用于 **Western blot、IHC/组织染色、IF 双通道共定位和 qPCR** 分析。它调用你配置的三个 WispLab 仓库中的分析代码，让脚本和 AI 助手使用同一套引擎，并输出 JSON 结果。

**English:** A local CLI and MCP interface for Western blot, histology, immunofluorescence colocalization, and qPCR analysis, powered by the configured WispLab engine repositories. [Read the full English documentation →](README.en.md)

## 能做什么

| 命令 | 引擎 | 当前接口提供的能力 |
| --- | --- | --- |
| `wb` | [blot-workbench](https://github.com/Gaoyuan-0423/blot-workbench) | PNG/TIFF 泳道提议、指定条带范围、局部或 rolling-ball 背景扣除、亮/暗信号、相对对照泳道的净信号比值 |
| `ihc` | [pathology-workbench](https://github.com/Gaoyuan-0423/pathology-workbench) | H-DAB、H&E、Masson 整图分析；阳性面积、核计数、核强度 H-score、阈值与 QC；H-DAB 支持阴性对照片标定 |
| `if` | 同上 | 默认红/绿通道的 Pearson、阈值后 Pearson 和 Manders M1/M2 |
| `pcr` | [pcr-workbench](https://github.com/Gaoyuan-0423/pcr-workbench) | 表格/RDML 导入、多内参归一化、ΔΔCt/Pfaffl 相对表达、NTC 报告和引擎提供的统计结果 |
| `doctor` | 本地环境 | 配置位置、引擎路径、Git 修订、未提交修改、运行依赖检查 |

CLI 与 MCP 共用 `lib.mjs`。WB/qPCR 由对应仓库的 `tsx` 运行；IHC/IF 通过本地 Vite 和 Playwright Chromium 调用浏览器引擎。**桥接包本身没有 npm 运行依赖**，但三个引擎及 Chromium 必须单独安装。运行的是本地配置的修订，更新本仓库不会自动更新引擎。

## 快速开始

需要 Git、Node.js ≥ 22.12，以及三个引擎所要求的运行环境。完整依赖安装与 AI 客户端设置见[上手指南](GETTING-STARTED.md)。

```sh
git clone https://github.com/Gaoyuan-0423/wisplab-cli.git
cd wisplab-cli
cp wisplab.config.example.json wisplab.config.json
# 编辑配置，填入已安装依赖的三个引擎仓库路径
node cli.mjs doctor
node cli.mjs --help
npm link                 # 可选：启用 wisplab 命令
```

```sh
# WB：6 泳道，手工选定目标面板范围，以泳道 1 为对照
wisplab wb blot.png --strip "140,85,160,350" --lanes 6 --bg rolling:50 --control 1

# qPCR：内参和对照名称必须与数据表一致；效率以百分数输入
wisplab pcr plate.csv --ref GAPDH,ACTB --control C1,C2
wisplab pcr plate.csv --ref GAPDH --control C1 --eff "LDHA=92;GAPDH=99"

# IHC：对照片标定限 H-DAB；IF：默认红/绿通道
wisplab ihc section.tif --profile h_dab --control-tif negative.tif
wisplab if duplex.png
```

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

`allowPaths` 限制 **MCP 工具的输入路径**，包括对照片和验证材料；校验解析符号链接后的实际路径。CLI 是直接执行的本地命令，不套用这层 MCP 限制。IHC/IF 启动的 Vite 只监听 `127.0.0.1`；端口冲突时修改 `ihc.devPort`。

## MCP 与 AI 技能

五个工具：`wb_quantify`、`ihc_quantify`、`if_colocalize`、`pcr_analyze`、`pcr_verify`。使用 stdio 传输；IHC/IF 调用会等待分析完成后返回结果。支持 2026-07-28 的 `server/discover` 与请求元数据，并保留旧客户端的 `initialize` 协商。

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

本次更新及实际验证范围见 [2026-10-30 核查报告](docs/validation-2026-10-30.md) 和 [CHANGELOG](CHANGELOG.md)。

```sh
npm test
npm run check
wisplab doctor > environment.json
```

`doctor` 检查本地依赖和修订，不联网判断“是否最新”，也不代替科学算法验证。更新引擎前保存当前 Git 修订和输入/参数，阅读对应仓库的变更；更新后重新安装其锁定依赖，再执行诊断和自己的参考数据回归。

最初 README 中的 2026-10-18 M1/M3/M4 数字是历史验证记录，依赖特定数据、参数和引擎版本，不能作为当前任意版本全部通过校准的证明。本仓库的自动化测试验证桥接行为；科学数值一致性应结合固定输入和对应引擎的验证材料重新检查。

`wisplab verify-pcr /path/to/validation` 需要另行获取可信的 `dump_app.ts`、`reference_check.py`、相应数据和 Python 环境；它会执行这些脚本。`wisplab grade <pcr|ihc|wb|synthetic16> submission.json` 需要旁边的 `../wisplab-benchmark/grade.mjs` 及其基准材料。它们均不包含在本仓库内。

## 当前边界

- WB 输出相对指定泳道的比值，不自动完成目标蛋白/上样内参的双重归一化。需要原始 PNG/TIFF；JPEG 转成 TIFF 不能恢复压缩时丢失的信息。
- IHC/IF 当前走整图默认参数，不暴露上游界面的手工 ROI、标尺、全部分割设置或模型选择。核强度 H-score 不等同于所有标记的临床评分；未提供标尺时不输出可解释的每 mm² 密度。
- 病理引擎对超过 4096 像素边长的图像降采样，16 位 TIFF 转为 8 位工作像素；WB 的 8/16 位图像流程与此不同。
- IF 接口使用引擎默认的 R/G 通道，不提供通道选择参数；上游界面有更多选项。伪彩图需先核实实际通道含义。
- qPCR 复用上游导入器，但 CLI 不提供交互式分组或全部上游设置；可通过 CLI/MCP 配置 Cq、偏差、z 分数和复孔 SD 质控，默认只报告。Excel 只使用第一个工作表。具体格式见[上手指南](GETTING-STARTED.md)。
- 分析命令输出 JSON，不导出叠加图或完整实验报告。需要可视化复核时使用相应引擎的界面。

问题与变更通过 [Issues](https://github.com/Gaoyuan-0423/wisplab-cli/issues) 和 [Pull requests](https://github.com/Gaoyuan-0423/wisplab-cli/pulls) 记录。许可证见 [LICENSE](LICENSE)。

质控参数与排除规则 / QC and exclusion policy: [说明 / Guide](docs/qpcr-qc.md).

分析追溯 / Analysis provenance: [格式与边界 / Format and limits](docs/provenance.md).

真实引擎回归 / Real-engine regression: [安装、固定版本与合成数据 / Setup, pinned revisions and fixtures](tests/integration/README.md).
