# WispLab CLI 与 AI 助手上手指南

**中文** | [English](GETTING-STARTED.en.md) · [返回介绍](README.md)

本指南安装本地 CLI/MCP 桥和三个分析引擎。你可以直接运行命令，也可以让支持终端或 MCP 的 AI 客户端代为调用。

如果已有 IHC 分析 JSON 和参考 JSON，只需本仓库代码与 Node.js，即可运行 `node cli.mjs ihc-validate result.json reference.json`。该离线比较不读取引擎配置，也不启动分析引擎或浏览器。

## 1. 准备环境

需要 Git、Node.js ≥ 22.12、npm，以及 macOS、Linux 或 Windows WSL 环境；具体引擎的要求以各自仓库为准。先运行 `node --version`。以下脚本读取 `engines.lock.json`，安装固定引擎修订、依赖与 Chromium；`--plan` 仅显示计划。目标目录和配置必须是新路径。命令中的数据路径和样本名需替换为自己的值。

```sh
git clone https://github.com/Gaoyuan-0423/wisplab-cli.git
cd wisplab-cli
node scripts/setup-engines.mjs --root ../wisplab-verified-engines --config ./wisplab.config.json --plan
node scripts/setup-engines.mjs --root ../wisplab-verified-engines --config ./wisplab.config.json
node cli.mjs doctor --strict
```

请安装开发依赖：WB/qPCR 需要其仓库内的 `tsx`，IHC/IF 需要 Vite、Playwright 与对应版本的 Chromium。不要使用 `--omit=dev`。如果所选旧引擎版本没有锁文件或缺少上述依赖，按该引擎的安装说明处理；`doctor` 会列出仍缺少的项目。Linux 上 Chromium 可能还需要系统依赖，按 Playwright 的安装提示补齐。

桥接包本身无需 `npm install`；安装与升级依赖会访问软件源，分析过程使用本地引擎。

## 2. 配置路径并检查

安装脚本已创建配置，不要用示例文件覆盖它；编辑其中的 `allowPaths` 以匹配实际数据和复核输出目录。若复用已有引擎，可从 `wisplab.config.example.json` 创建一个新的配置文件。以下示例适用于同级引擎仓库和 `~/data`：

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

相对引擎路径以配置文件为基准；`~` 会展开为用户主目录。MCP 输入、对照片、验证材料和 `reviewDir` 输出目录必须位于 `allowPaths` 里，符号链接按实际目标检查。只添加需要访问的目录。

```sh
node cli.mjs doctor
node cli.mjs --help
node cli.mjs --version
npm link                       # 可选：之后可用 wisplab 代替 node cli.mjs
```

`doctor.ready` 表示检查的依赖存在；`verified` 还要求三个引擎为干净、匹配锁文件的仓库修订。`doctor --strict` 未验证时返回非零，报告包含当前/期望 revision、`matchesLock` 和 `dirty`。它不自动更新或证明科学准确性，详见[固定版本安装](docs/verified-engines.md)。使用多套配置时可传 `--config /path/to/config.json`，或设置 `WISPLAB_CONFIG`；显式路径优先。

## 3. 先跑一次明确的分析

安装全局命令后：

```sh
wisplab wb /path/to/blot.png --lanes 6 --bg local --control 2
wisplab ihc /path/to/section.tif --profile h_dab
wisplab if /path/to/duplex.png --channels R,B
wisplab pcr-preview /path/to/plate.csv
wisplab pcr /path/to/plate.csv --ref GAPDH --control NC
```

未执行 `npm link` 时，在 CLI 目录下把 `wisplab` 换成 `node cli.mjs`。

| 分析 | 必须核对的信息 | 输出位置 |
| --- | --- | --- |
| WB | 原图 PNG/TIFF、泳道数、亮/暗信号、对照泳道；多面板图还需 `--strip y,h,x0,x1` | `images[].lanes[]`：`net`、`ratio`、`warnings` |
| IHC | 染色预设、图像质量；H-DAB 可加 `--control-tif negative.tif` | `files[].overall`、`thresholdUsed`、`warnings`、`qc` |
| IF | 所选两个 RGB 通道分别代表什么；默认 R/G，可用 `--channels R,B` 更换 | `files[].coloc`：Pearson、Manders、阈值 |
| qPCR | `Target` 中的内参名称、`Sample` 中的对照名称、实验重复含义 | `files[].primaryAnalysis`（先核对 `status`、`statisticalUnit`）、`refGenesUsed`、`controlSamples`、`warnings`、`ntcReport` |

qPCR 复用上游导入器：支持 CSV/TXT/TSV（UTF-8/GBK）、Excel（XLSX/XLS/XLSM/XLSB）和 RDML。Excel 用 `--sheet` 按准确名称选表，省略时默认首表并提示其他表；不自动合并。`pcr-preview` 可先检查来源行、列映射与问题，`--header-row` 为含空行的 1-based 物理行号，`--columns` 可用准确表头名或 1-based 列号。RDML 中声明的效率会被应用，显式 `--eff` 优先。效率以百分数输入，例如 `--eff "LDHA=92;GAPDH=99"` 表示 92% 和 99%，不是每周期扩增倍数。可配置 Cq 上下限、绝对偏差、z 分数、复孔 SD 报告及显式行排除，默认只报告、不自动剔除；只启用部分规则不代表全部 QC 通过。显式生物学分组使用 `--groups` 与 `--control-group`，默认非配对 Welch；只有已确认实验配对时才加 `--paired --pair-ids`。技术孔不增加生物学 n，配对分析只使用双方均有效的完整配对。95% CI 是单次比较未校正区间，p 值另作 Holm 校正；见[导入与配对说明](docs/pcr-import-design.md)。不提供一般重复测量模型或跨板校正。

单个内参即可分析（例如 `--ref GAPDH`），多内参为可选功能。优先读取每个文件的 `primaryAnalysis`：`kind: biological-groups` 表示用户声明的生物学样本分组，`kind: well-level` 表示逐孔统计。先检查 `status` 和 `error`，再读取 `summaries`、`comparisons`。请求生物学分组后若出现错误，主结果仍是生物学分组的错误状态；不能用保留的 `results` 逐孔统计代替。QC/NTC 诊断可单独复核。

逐文件分析错误会保留在 JSON 中，同时使 CLI 退出码为 1，MCP 返回 `isError: true`。即使运行成功，也要检查每个文件的 `warnings`。图像选择、重复设计和阈值不合适时，能够返回数值也不代表结果有效。WB 对照泳道净信号为正时其自身比值应为 1；净信号不为正时比值可能为 `null`。IHC 的核强度 H-score 需结合分割结果复核。

先预览映射，再用同一映射分析；列号和表头行从 1 开始，工作表参数是名称：

```sh
wisplab pcr-preview plate.xlsx --sheet Results --header-row 7 --columns '{"sample":1,"target":2,"cq":5}'
wisplab pcr plate.xlsx --sheet Results --header-row 7 --columns '{"sample":1,"target":2,"cq":5}' --ref GAPDH --control C1,C2
```

IHC 可用哈希绑定的 `--roi-manifest rois.json` 导入原图矩形 ROI，`--mpp 0.5` 表示原图 µm/px；只有已知标尺时才填写。`--nuclei` 导出模型核中心，`--review-dir` 输出本地 PNG/HTML 与完整结果 JSON。IF 可选 RGB 通道及导出，但不支持 ROI。叠加显示阳性染色/通道信号，不是核轮廓。详见[图像复核](docs/image-review.md)。

```sh
mkdir -p ./reviews
wisplab ihc section.png --nuclei --review-dir ./reviews > result.json
wisplab ihc-annotation-pack result.json --images-root . --output-dir ./reviews
# 人工完成标注后；8为预先选定的原图像素匹配半径示例
wisplab ihc-nuclei-validate result.json nuclei-reference.json --match-radius 8
```

后两条是无需引擎配置的离线命令。标注包仅嵌入原始 PNG/JPEG，不展示模型核点；支持保存/恢复草稿和可选独立人工 H-score，后者不能从二元标签推算。空间比较报告一对一核检测与匹配核分类，不提供 Dice/IoU。`compared` 表示比较完成，并非精度达标。**真实人工准确性验证仍待独立标注完成。** 详见[核标注与比较](docs/ihc-nuclei-validation.md)。

默认整批时限 300000 ms、IHC/IF 单图 120000 ms；用 `--timeout-ms` / `--file-timeout-ms` 调整。CLI 进度写 stderr，Ctrl-C 取消；MCP 仅对提供进度 token 的请求发通知，取消与 ping 保持响应。IHC 单图超时会保留结果并重启处理后续图，整批超时结束未完成项。WB 普通逐图错误可保留其他成功图；强制中断时 WB/qPCR 可能尚无完整 JSON。详见[运行控制](docs/runtime-controls.md)。

## 4. 可选：安装 AI 技能

`skills/` 中包含 WB、IHC、IF 和 qPCR 四个技能。先查看内容，再按客户端的技能目录规则安装。使用 `~/.agents/skills/` 的客户端可运行：

```sh
mkdir -p ~/.agents/skills
cp -Rn skills/wisplab-* ~/.agents/skills/
```

此命令不覆盖同名已有文件；更新已有技能时需自行比较并替换。重新加载客户端后，可直接给出文件路径和分析要求，例如：

> 分析 /path/to/plate.csv，GAPDH 做内参，C1、C2 是对照；请报告相对表达、所用统计方法和所有警告。

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

不同客户端配置格式可能不同；要点是用 Node 启动 `mcp-server.mjs` 并传入配置绝对路径。客户端应列出六个工具：`wb_quantify`、`ihc_quantify`、`if_colocalize`、`pcr_preview`、`pcr_analyze`、`pcr_verify`。后者需要另行取得可信的验证脚本和数据，普通分析不需要它。

计算在本机执行，但 AI 客户端可能向模型服务发送提示词、结果或附件；本桥接程序的路径检查不决定这些传输行为。

## 6. 常见问题与更新

| 问题 | 处理方式 |
| --- | --- |
| 配置找不到或路径错误 | 分析命令使用绝对 `--config`；运行 `doctor` 检查最终路径。离线 `ihc-validate` 不需要配置 |
| 缺少 `tsx`、Vite 或 Chromium | 在对应引擎仓库安装锁定依赖；IHC 再执行 `npx playwright install chromium` |
| IHC/IF 端口被占用 | 修改配置中的 `ihc.devPort`；程序不会复用未知的现有服务 |
| MCP 拒绝路径 | 将所需数据或复核输出目录加入 `allowPaths`；检查符号链接实际目标 |
| WB 只有 JPG | 优先取得原始 PNG/TIFF；转格式无法消除 JPEG 压缩造成的误差 |
| 需要 ROI、报告或叠加图 | IHC 用 `--roi-manifest`，IHC/IF 用 `--review-dir`；IF ROI 与 WB 图像导出仍不支持 |
| `grade` 或 `verify-pcr` 失败 | 检查另外分发的 benchmark/验证脚本、数据及运行依赖是否齐全 |

更新前保存 `doctor`、结果 JSON 和参数。锁定安装使用 detached 修订；更新桥接仓库后，应按新锁文件在新的目标/配置路径重新运行安装脚本，再执行 `doctor --strict` 与固定数据回归。手工管理的引擎可单独升级，但可能不再匹配锁文件；更新依赖及对应 Chromium 后重新检查，不把 `ready` 当成 `verified`。

卸载全局链接可执行 `npm unlink -g wisplab-cli`，再从客户端移除本工具的 MCP 配置和技能。删除代码目录前先保存配置和需要保留的本地材料。

[完整能力与边界](README.md) · [问题记录](https://github.com/Gaoyuan-0423/wisplab-cli/issues) · [变更记录](https://github.com/Gaoyuan-0423/wisplab-cli/pulls)

质控参数与排除规则 / QC and exclusion policy: [说明 / Guide](docs/qpcr-qc.md).

单个内参即可进行 qPCR 分析（例如 `--ref GAPDH`）；多个内参为可选功能。 / One reference gene is sufficient (for example `--ref GAPDH`); multiple reference genes are optional.
