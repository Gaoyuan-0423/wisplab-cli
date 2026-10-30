# WispLab CLI 与 AI 助手上手指南

**中文** | [English](GETTING-STARTED.en.md) · [返回介绍](README.md)

本指南安装本地 CLI/MCP 桥和三个分析引擎。你可以直接运行命令，也可以让支持终端或 MCP 的 AI 客户端代为调用。

## 1. 准备环境

需要 Git、Node.js ≥ 22.12、npm，以及 macOS、Linux 或 Windows WSL 环境；具体引擎的要求以各自仓库为准。先运行 `node --version`。下面假定四个仓库位于同一个父目录；命令中的路径和样本名都需要替换为自己的值。

```sh
git clone https://github.com/Gaoyuan-0423/blot-workbench.git
git clone https://github.com/Gaoyuan-0423/pathology-workbench.git
git clone https://github.com/Gaoyuan-0423/pcr-workbench.git
git clone https://github.com/Gaoyuan-0423/wisplab-cli.git

(cd blot-workbench && npm ci)
(cd pathology-workbench && npm ci && npx playwright install chromium)
(cd pcr-workbench && npm ci)
cd wisplab-cli
```

请安装开发依赖：WB/qPCR 需要其仓库内的 `tsx`，IHC/IF 需要 Vite、Playwright 与对应版本的 Chromium。不要使用 `--omit=dev`。如果所选旧引擎版本没有锁文件或缺少上述依赖，按该引擎的安装说明处理；`doctor` 会列出仍缺少的项目。Linux 上 Chromium 可能还需要系统依赖，按 Playwright 的安装提示补齐。

桥接包本身无需 `npm install`；安装与升级依赖会访问软件源，分析过程使用本地引擎。

## 2. 配置路径并检查

```sh
cp wisplab.config.example.json wisplab.config.json
```

编辑配置。例如四个仓库互为同级目录、实验数据放在 `~/data` 时：

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

相对引擎路径以配置文件为基准；`~` 会展开为用户主目录。MCP 输入、对照片和验证材料必须位于 `allowPaths` 里；符号链接也按实际目标路径检查。只添加你希望工具读取的目录。

```sh
node cli.mjs doctor
node cli.mjs --help
node cli.mjs --version
npm link                       # 可选：之后可用 wisplab 代替 node cli.mjs
```

`doctor` 的 `ready: true` 表示所检查的本地依赖存在；同时记录引擎 `revision` 和 `dirty`。它不会更新引擎或证明数值正确。使用多套配置时可传 `--config /path/to/config.json`，或设置 `WISPLAB_CONFIG`；显式路径优先。

## 3. 先跑一次明确的分析

安装全局命令后：

```sh
wisplab wb /path/to/blot.png --lanes 6 --bg local --control 2
wisplab ihc /path/to/section.tif --profile h_dab
wisplab if /path/to/duplex.png
wisplab pcr /path/to/plate.csv --ref GAPDH --control NC
```

未执行 `npm link` 时，在 CLI 目录下把 `wisplab` 换成 `node cli.mjs`。

| 分析 | 必须核对的信息 | 输出位置 |
| --- | --- | --- |
| WB | 原图 PNG/TIFF、泳道数、亮/暗信号、对照泳道；多面板图还需 `--strip y,h,x0,x1` | `images[].lanes[]`：`net`、`ratio`、`warnings` |
| IHC | 染色预设、图像质量；H-DAB 可加 `--control-tif negative.tif` | `files[].overall`、`thresholdUsed`、`warnings`、`qc` |
| IF | 图像的红/绿通道分别代表什么；当前 CLI 不支持更换通道 | `files[].coloc`：Pearson、Manders、阈值 |
| qPCR | `Target` 中的内参名称、`Sample` 中的对照名称、实验重复含义 | `files[].results`、`refGenesUsed`、`controlSamples`、`warnings`、`ntcReport` |

qPCR 复用上游导入器：支持 CSV/TXT/TSV（UTF-8/GBK）、Excel（XLSX/XLS/XLSM/XLSB）和 RDML。Excel 只使用第一个工作表；多工作表输入会有警告。RDML 中声明的效率会被应用，显式 `--eff` 优先。效率以百分数输入，例如 `--eff "LDHA=92;GAPDH=99"` 表示 92% 和 99%，不是每周期扩增倍数。CLI 不提供交互式分组、孔排除或全部 QC 设置；Cq 上下限、绝对偏差和复孔 SD 参数当前未启用，不能将未报告这些问题解读为 QC 全部通过。

逐文件分析错误会保留在 JSON 中，同时使 CLI 退出码为 1，MCP 返回 `isError: true`。即使运行成功，也要检查每个文件的 `warnings`。图像选择、重复设计和阈值不合适时，能够返回数值也不代表结果有效。WB 对照泳道净信号为正时其自身比值应为 1；净信号不为正时比值可能为 `null`。IHC 的核强度 H-score 需结合分割结果复核。

## 4. 可选：安装 AI 技能

`skills/` 中包含 WB、IHC、IF 和 qPCR 四个技能。先查看内容，再按客户端的技能目录规则安装。使用 `~/.agents/skills/` 的客户端可运行：

```sh
mkdir -p ~/.agents/skills
cp -Rn skills/wisplab-* ~/.agents/skills/
```

此命令不覆盖同名已有文件；更新已有技能时需自行比较并替换。重新加载客户端后，可直接给出文件路径和分析要求，例如：

> 分析 /path/to/plate.csv，GAPDH 和 ACTB 做内参，C1、C2 是对照；请报告相对表达、所用统计方法和所有警告。

> 定量 /path/to/blot.png 的目标面板，6 个泳道，最左的 marker 排除，泳道 2 为对照，使用 rolling ball 50。

AI 必须使用实际输出，不应自行编造缺少的对照、内参、数值或检验结果。

## 5. 可选：连接 MCP

给支持 `mcpServers` 配置的客户端加入：

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

不同客户端配置格式可能不同；要点是用 Node 启动 `mcp-server.mjs` 并传入配置绝对路径。客户端应列出五个工具：`wb_quantify`、`ihc_quantify`、`if_colocalize`、`pcr_analyze`、`pcr_verify`。后者需要另行取得可信的验证脚本和数据，普通分析不需要它。

计算在本机执行，但 AI 客户端可能向模型服务发送提示词、结果或附件；本桥接程序的路径检查不决定这些传输行为。

## 6. 常见问题与更新

| 问题 | 处理方式 |
| --- | --- |
| 配置找不到或路径错误 | 使用绝对 `--config`；运行 `doctor` 检查最终路径 |
| 缺少 `tsx`、Vite 或 Chromium | 在对应引擎仓库安装锁定依赖；IHC 再执行 `npx playwright install chromium` |
| IHC/IF 端口被占用 | 修改配置中的 `ihc.devPort`；程序不会复用未知的现有服务 |
| MCP 拒绝路径 | 将数据所在目录加入 `allowPaths`；检查符号链接实际目标 |
| WB 只有 JPG | 优先取得原始 PNG/TIFF；转格式无法消除 JPEG 压缩造成的误差 |
| 需要 ROI、报告或叠加图 | 使用对应引擎界面；CLI 当前返回 JSON |
| `grade` 或 `verify-pcr` 失败 | 检查另外分发的 benchmark/验证脚本、数据及运行依赖是否齐全 |

更新前保存 `wisplab doctor` 输出和参数，检查各仓库的本地修改；在工作区干净且适合更新时，对所需仓库运行 `git pull --ff-only`。引擎更新后执行 `npm ci`；Playwright 更新后重新安装对应 Chromium。随后运行桥接测试、`doctor` 和自己的固定数据回归。

卸载全局链接可执行 `npm unlink -g wisplab-cli`，再从客户端移除本工具的 MCP 配置和技能。删除代码目录前先保存配置和需要保留的本地材料。

[完整能力与边界](README.md) · [问题记录](https://github.com/Gaoyuan-0423/wisplab-cli/issues) · [变更记录](https://github.com/Gaoyuan-0423/wisplab-cli/pulls)
