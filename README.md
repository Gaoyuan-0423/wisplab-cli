# wisplab-cli

WispLab 三引擎的无头命令行 + MCP server。零运行时依赖：分发到各仓库自己的 `tsx`／`vite`／`playwright`，保证跑的永远是**官方引擎代码**。CLI 与 MCP server 共用同一份调度（`lib.mjs`）。

> **人不需要学本 README**：四个 agent 技能（`~/.agents/skills/wisplab-{wb-quantification,ihc-quantification,if-colocalization,qpcr-analysis}/`）已把「用户的话 → 正确命令 → 结果解读」全流程教给 AI——直接对 AI 说"帮我定量这张膜/这张切片/这张 qPCR 表"即可。本文件只是命令的参考手册。

## 安装（一次性）

```sh
git clone https://github.com/Gaoyuan-0423/wisplab-cli.git && cd wisplab-cli
cp wisplab.config.example.json wisplab.config.json   # 改成你的三个仓库路径
# 三个引擎仓库就位并 npm install 后：
npm link    # 可选；也可直接 node cli.mjs
```

新人上手与自然语言用法见 [GETTING-STARTED.md](GETTING-STARTED.md）。

## 命令与已校准用法

```sh
# WB：6 泳道 β-Actin 图，rolling ball r=50，泳道 1 为对照
wisplab wb CST-cst-4970-beta-actin-01.png --strip "140,85,160,350" --lanes 6 --bg rolling:50
wisplab wb CST-cst-4970-beta-actin-01.tif --strip "140,85,160,350" --lanes 6 --bg local   # 与 M4 记录逐值一致(≤1e-05)

# qPCR：双内参 + 两对照样本（与 M1 独立核对记录逐值一致 0.00e+00）
wisplab pcr RELATIVE_example.csv --ref GAPDH,ACTB --control AiW002-2-D0,KYOU-D0
wisplab pcr 表.csv --ref GAPDH --eff "LDHA=200"          # Pfaffl 效率校正

# IHC/染色：H-DAB 整图定量（与 M3 记录逐位一致）；--control-tif 走对照片标定
wisplab ihc ptglab_ki67_110311.jpg
wisplab ihc 样本.tif --control-tif 无染色对照片.tif

# IF 双通道共定位（独立子命令；与 M3 CD20-CD3 记录同引擎）
wisplab if duplex.jpg
```

`--strip y,h,x0,x1`：多面板截图先人工定位目标面板条带行（含上下背景余量），x 边界排除 marker 梯带与文字列，引擎在条带内精确分割泳道。单面板图可省略，让引擎全图提议。

## MCP server（ZCode / Codex / WispScience 接入）

```sh
node ~/Downloads/WispLab预印本验证/wisplab-cli/mcp-server.mjs
```

五个工具：`wb_quantify`／`ihc_quantify`／`if_colocalize`／`pcr_analyze`／`pcr_verify`。客户端配置示例（ZCode）：

```json
{ "mcpServers": { "wisplab": { "command": "node",
  "args": ["<你的路径>/wisplab-cli/mcp-server.mjs"] } } }
```

安全：文件路径必须在 `allowPaths`（config，默认 ~/Downloads 与 /tmp）内，域外路径直接拒绝。

## 校准状态（2026-10-18）

| 入口 | 基准 | 结果 |
| --- | --- | --- |
| `wb --bg local`（同输入） | M4 记录 app_results.json | net 相对差 ≤1e-05 |
| `wb --bg rolling:50` | M4 parity 语义 | 值低于 local 属预期；单步一致性见仓库 parity 记录 |
| `pcr`（S2 场景） | M1 记录 app_output_S2 | FC 与 p 值逐值 0.00e+00 |
| `ihc`（H-DAB） | M3 记录 results_m3 | 阳性面积/阈值逐位一致 |
| `if`（CD20-CD3 双染） | M3 记录 results_m3/if | 同引擎冒烟通过 |
| MCP 握手/工具调用/路径防护 | /tmp/mcp-test.mjs | initialize+tools/list+call 全过 |

## 已知边界

- `ihc`/`if` 首次运行自动拉起 vite dev（约 2–15 秒），结束时自动回收；端口冲突改 config `ihc.devPort`。
- 語料 JPEG 输入对 wb 是设计内拒绝（仅 TIFF/PNG）；ihc/if 接受 JPEG/TIFF/PNG。
- 输出均为 JSON（stdout）；叠加图当前不导出（需要时用 `scripts-ihc/run_m3.mjs`）。

