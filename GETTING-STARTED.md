# WispLab AI 定量助手 · 上手指南（给同事/新用户）

适合谁：想用 AI 助手做 **Western blot、IHC/染色、IF 共定位、qPCR** 定量的实验研究者。
特点：**全程本地计算，实验数据不出你的电脑**；你只说中文自然语言，AI 负责跑引擎和给结论表。

整体两层：

- **WispLab 网页版**（https://wisplab.top 及 wb/pcr/pathology 子域）：浏览器打开即用，零安装，人工操作。
- **本地 AI 助手**（本指南）：在你电脑上装好三引擎 + 一个 CLI/MCP 桥，之后在任何支持 MCP 或终端的 AI 客户端里用自然语言驱动定量。以下全部讲这一层。

---

## 一、15 分钟安装（一次性）

### 0. 前提

- macOS / Linux / Windows（WSL），**Node.js ≥ 22**（`node -v` 检查），git。
- 一个 AI 客户端：ZCode、Codex CLI，或任何支持 MCP 的应用。

### 1. 克隆三个引擎仓库并安装依赖

```sh
git clone https://github.com/Gaoyuan-0423/blot-workbench.git
git clone https://github.com/Gaoyuan-0423/pathology-workbench.git
git clone https://github.com/Gaoyuan-0423/pcr-workbench.git
cd blot-workbench && npm install && cd ..
cd pathology-workbench && npm install && cd ..
cd pcr-workbench && npm install && cd ..
```

每个约 1–2 分钟。路径随意，后面会登记。

### 2. 克隆 wisplab-cli

```sh
git clone https://github.com/Gaoyuan-0423/wisplab-cli.git && cd wisplab-cli
```

### 3. 登记你的仓库路径

```sh
cp wisplab.config.example.json wisplab.config.json
```

编辑 `wisplab.config.json`，把三个路径改成**你自己的克隆位置**：

```json
{
  "repos": {
    "wb": "/你的路径/blot-workbench",
    "ihc": "/你的路径/pathology-workbench",
    "pcr": "/你的路径/pcr-workbench"
  },
  "ihc": { "devPort": 5173 }
}
```

### 4. 可选：全局命令

```sh
cd ~/wisplab-cli && npm link     # 之后任何目录可直接敲 wisplab
```

### 5. 安装 4 个 AI 技能（推荐）

本仓库 `skills/` 下自带 4 个技能目录（`wisplab-wb-quantification`、`wisplab-ihc-quantification`、`wisplab-if-colocalization`、`wisplab-qpcr-analysis`，各含一个 SKILL.md），拷到你 AI 客户端的技能目录（ZCode：`~/.agents/skills/`）：

```sh
cp -R skills/* ~/.agents/skills/
```

重启客户端后生效——**这些技能教 AI 怎么拼命令、看图定泳道、解读结果，你只管说中文**。

### 6. 可选：注册 MCP server

在 AI 客户端的 MCP 配置里加（以 Codex 的 `config.toml` 风格为例，ZCode 同理填 command/args）：

```toml
[mcp_servers.wisplab]
command = "node"
args = ["/你的路径/wisplab-cli/mcp-server.mjs"]
```

装了技能后这条可省——技能走终端调用；MCP 的好处是结构化工具调用与路径防护。

---

## 二、怎么用（三种方式等价，选顺手的）

### 方式 A：自然语言（装了技能后最常用）

直接对 AI 说人话 + 给文件路径：

> 「这是我的 QuantStudio 导出：~/data/plate1.csv。GAPDH 做内参，NC 组是对照，帮我算相对表达。」

> 「定量这张膜：~/data/blot1.png，6 个泳道，最左是 marker 不要算，泳道 2 是对照，rolling ball 50。」

> 「这张 IHC 切片阳性面积多少？H-score 多少？」

AI 会自己拼命令、跑引擎、把结果整理成表格并解读（见第三节真实样例）。

### 方式 B：让 AI 调 MCP 工具

装了 MCP 后，AI 会自动改用结构化工具调用（`pcr_analyze`、`wb_quantify`……），效果相同，路径防护更强（只允许读你允许的目录）。

### 方式 C：手动命令（想精确控制时）

```sh
wisplab wb 泡图.png --strip "140,85,160,350" --lanes 6 --bg rolling:50 --control 2
wisplab ihc 切片.tif --control-tif 阴性对照片.tif
wisplab if 双染图.jpg
wisplab pcr plate1.csv --ref GAPDH --control NC
wisplab grade wb 我的提交.json      # 给 AI/脚本的算数打分（67 项基准）
```

---

## 三、三个真实例子（输出的样子）

### 例 1 · qPCR（真实 QuantStudio 导出）

你说：「分析 ~/data/RELATIVE_example.csv，GAPDH 和 ACTB 做内参，AiW002-2-D0 和 KYOU-D0 是对照。」

AI 回（节选）：

| 基因 | 样本 | 相对表达 | Dunnett 校正 p | 显著性 |
| --- | --- | --- | --- | --- |
| CAMK2A | AiW002-2-D7 | 5.05× | 7.2e-4 | ** |
| GRIN1 | AiW002-2-D7 | 26.7× | 3.2e-4 | ** |
| PAX6 | AiW002-2-D7 | 0.14×（下调） | 8.9e-6 | *** |

并附：所用内参与对照、NTC 报告、每条警告的人话解释。

### 例 2 · Western blot

你说：「定量 ~/data/blot1.png，6 泳道，泳道 2 是对照。」

AI 先看图定位面板条带行（多面板截图会自动裁条带），然后输出：

| 泳道 | 净信号 | 相对泳道 2 |
| --- | --- | --- |
| 1 | 173,214 | 1.000 |
| 2 | 2,712 | 0.016 |
| … | … | … |

并注明：背景方法（rolling ball r=50，与 ImageJ 像素级一致）、有无饱和像素警告。

### 例 3 · IHC

你说：「这张 IHC 阳性面积多少？我这里有张阴性对照片。」

AI 输出：阳性面积 X.X%、H-score（0–300）、阳性核/总核、生效阈值；有对照片时自动按 0.1% 假阳率标定阈值，并在直方图分离度低时主动提示「建议对照片标定」。

---

## 四、常见问题

| 问题 | 回答 |
| --- | --- |
| 我的实验数据会上传吗？ | 不会。三引擎全部本地计算；MCP/CLI 只读你明确给出的文件路径。唯一例外：WB 的 BYOK 视觉泳道候选功能，需你在界面里**主动配置**自己的 AI API，且仅该功能联网。 |
| 图是 JPG，wb 命令报错？ | WB 引擎按设计只收 TIFF/PNG（16 位也支持）。`sips -s format tiff 图.jpg --out 图.tif` 转换后再用。IHC/IF 接受 JPG。 |
| 泳道/条带数识别错了？ | 泳道提议是半自动设计：你告诉 AI 泳道数和面板位置（多面板截图让 AI 先看图圈条带行），或直接手画。 |
| 和 ImageJ 比准不准？ | 背景扣除与 ImageJ 逐像素一致（≥99.99%）；全流程净信号与独立参考实现相对差 ≤3.2e-04（记录见仓库验证文档）。 |
| 基准里的图能给我吗？ | 厂商版权图不 redistribution；公开基准只含期望数字与来源 URL 清单，可自行从厂商页面获取复现。 |
| 换电脑/换路径？ | 只改 `wisplab.config.json` 里的三个路径。 |

## 五、更新与卸载

- 更新：三个仓库 `git pull && npm install`；wisplab-cli `git pull`。
- 卸载：`npm rm -g wisplab-cli`（若 link 过）+ 删目录 + 移除客户端 MCP 配置与技能目录。实验数据（在你自己的数据目录/浏览器 IndexedDB）不受影响。

---

*对应引擎版本：blot-workbench / pathology-workbench / pcr-workbench，tag `wisplab-paper-2026-10-17` 及之后。验证记录：各仓库验证文档与 Zenodo 存档（DOI 见项目主页）。*
