# PCR Workbench · PCR 工作台

**在线使用：<https://gaoyuan-0423.github.io/pcr-workbench/>** · [仓库](https://github.com/Gaoyuan-0423/pcr-workbench)

纯网页端的 qPCR 懒人分析工具：把仪器下机导出的结果文件拖进来，自动识别列和孔板，算 ΔΔCt，出可发表图表和带 ΔΔCt 的 Excel 表格。**文件解析、计算和导出在浏览器本地完成；可选 AI 解读仅在用户主动请求时发送分析摘要。**

## 功能（v0.1）

- **直接导入下机结果**：支持 Bio-Rad CFX、Thermo QuantStudio / StepOne、Roche LightCycler、Qiagen Rotor-Gene 等仪器软件导出的 `.xlsx / .xls / .csv / .tsv / .txt`；中英文列名自动识别（含 LightCycler 的 `CP`、`Detection Cell` 等非标准叫法），UTF-8 / GBK 编码自动识别；多工作表时弹出选择器。
- **RDML 开放标准直接导入**：`.rdml` 文件（ZIP 容器或裸 XML，1.0/1.1 兼容）拖入即用——AriaMx 原生支持、多家仪器有插件导出。样本类型（NTC/标准品）自动映射、标准品数量进标准曲线、**靶标声明的扩增效率自动应用为 Pfaffl 校正**；Roche 的 UUID 样本/run id 自动转可读名。
- **孔板自动识别**：检出孔位列后自动渲染 96 / 384 孔板视图，按基因着色，点击孔位整组剔除 / 恢复；无孔位列自动降级为表格模式。
- **多板合并分析**：一次拖入多个导出文件（同一实验的分板数据），每文件独立识别列映射，来源身份保留板号与样本名，不因同名自动合并。使用者确认不同板上的记录属于同一实验单位后，才汇总该单位的技术孔；可处理“板 1 做内参、板 2 做目标基因”的显式映射。文件无板号列时以文件名作板名。
- **ΔΔCt 引擎（Livak 法）**：复孔聚合、多内参基因池化；来源样本用板号与样本名区分。使用者在实验设计表中明确独立单位和组别后，同一单位的技术孔先汇总，再计算单位 ΔCt 与 Fold Change。
- **统计**：默认只显示描述结果。仅已确认且无冲突的独立组设计可进行组间推断：2 组 Welch t；≥3 组（含对照）单因素 ANOVA + **Dunnett vs 对照**。统计输入是单位级 ΔCt；`nBio` 和 `nTech` 分列，样本行不报告 p。每组有效单位不足 2、内参不全或统计量不可计算时不提供相应 p。配对/重复测量暂只描述；独立性仍需实验者依据实验设计确认。
- **Pfaffl 效率校正**：在实验配置中为任一基因填入扩增效率百分比（来自标准曲线，效率% = (10^(−1/斜率) − 1) × 100），各内参分别按自身效率转换为相对量，再取几何均值作为归一化分母；单内参即 Pfaffl 公式。一个稳定内参即可，多内参为可选；不能先平均内参效率。全部留空（默认 100%）时保留 Livak 路径。
- **标准曲线自动拟合**：数据含稀释系列（Task=STANDARD 列，或 Std/标准 命名 + 数量列/名称中的数量）时自动按基因拟合 Cq ~ log10(浓度)，给出斜率、R² 与效率%，一键应用为 Pfaffl 效率；一键分析模式下 R² ≥ 0.98 的拟合自动应用。标准品孔自动排除在样本分析之外。
- **QC**：Cq 上下限、缺值检测、复孔绝对偏差与 z 分数离群标记，人工复核后一键剔除。
- **熔解曲线 QC**：RDML 内的原始熔解数据（mdp 温度-荧光点）自动做峰检测（导数平滑 + 噪声尺度阈值 + 60°C 下限），按基因汇总单峰/多峰/无峰孔；多峰在报告与 Excel 中告警（提示非特异扩增或引物二聚体）。
- **NTC 污染检查**：自动识别 Task 列或样本名（NTC / NTC-1 等惯例）标记的无模板对照孔，逐基因判定——提前扩增（Cq < 35）判疑似污染并告警，晚期扩增提示关注，NTC 自动排除在分析之外，检查结果随 Excel 一并导出。内参基因的 NTC 同样检查。
- **导出**：多 sheet Excel（ΔΔCt 结果 / 原始数据+QC / 项目信息）、结果 CSV、图表 SVG（矢量）与 PNG。
- **图表定制**：标题、默认留空的副标题、横纵坐标标题、字体（默认无衬线 / Times New Roman / Arial）、字号和组内总宽度；单基因在柱下显示组别且不显示图例，多基因以基因名作为横轴标签、组别作为图例，图例可置于上下左右或隐藏。支持宽高比例预设、锁定比例调整尺寸、整体等比缩放，SVG 与 PNG 保持相同布局（PNG 默认 2 倍分辨率）。
- **Y 轴与误差棒**：线性 / log2 / log10 刻度；真正的双段断轴可根据当前数据推荐省略区间，也可调整区间、上段上限与下段高度比例，高柱和误差棒跨断口分别绘制。非法断轴范围会明确提示并暂停图片导出；切换到对数刻度时关闭断轴。误差棒支持 SD / SEM / 无，显著性支持星号 / p 值 / 两者 / 不显示。图下方保留统计学方法说明。
- **Prism 工程导出（.pzfx）**：技术孔 Cq、描述性 FC 和技术 SD 分表；确认设计后另导出每独立单位一行的 ΔCt/FC 组表。缺失值留空并说明，不把均值和 SD 当作重复观测。Excel 同时保存实验设计、样本描述与组级统计。
- **课题管理**：多课题独立保存（IndexedDB），「📂 我的课题」随时切换/重命名/删除；旧版单项目数据自动迁移。
- 项目自动保存在浏览器本地（IndexedDB），刷新后可恢复。

## 不支持的（诚实声明）

- 不解析仪器专有二进制格式（`.eds` / `.pcrd` / `.rex` / `.ixo`）——请先在仪器软件里导出为表格文件，这也是各家仪器软件的官方推荐交换方式。
- v2.2 不含 LightCycler 熔解摘要表（No. Tm 格式）直接导入（当前可在第 3 步附加熔解摘要表）、多因子两因素矩阵分组——在路线图上。

## 一键智能分析

不想走四步向导？上传页点击 **🪄 一键智能分析**：自动识别列映射、从样本名/组别推断对照组、自动勾选常见内参基因，跑完全流程后直接给出**质量报告**——

- **质量分（0–100）**：按问题严重度扣分制
- **发现的问题**：三级分类（严重/警告/提示），覆盖 NTC 污染、无复孔、复孔高波动、内参不稳定、Cq 越界、对照组缺失、统计边界等 15+ 种规则
- **优化方向**：每条问题给出可执行建议（多内参池化、增加重复、移液排查、NTC 排查步骤等）

## 本机分析 API（可选）

供脚本/其他工具调用的一键分析接口，**仅监听 127.0.0.1**，数据不离开本机、不落盘：

```bash
npm run api   # 启动于 http://127.0.0.1:4318

curl -s -X POST --data-binary @result.csv \
  "http://127.0.0.1:4318/api/analyze?filename=result.csv" | jq .
```

返回 JSON：`experiment`（自动建议的对照/内参、设计状态）、`report`（score / issues / advice）、`ntc`、`results`（描述性 ΔΔCt 表及来源身份，样本 p 为空）、`groupResults`、`designIssues`、`qcFlaggedRows`。此 HTTP 自动分析入口未接受设计确认，因此维持描述模式；明确设计可使用核心 API 或 WispLab CLI/MCP。另有 `GET /api/health`。

Experimental units must be explicitly confirmed before inference. Technical wells do not increase biological n. Confirmed independent designs use one delta Ct per unit, Welch for two groups, or ANOVA including controls plus Dunnett for multiple groups. Unconfirmed, invalid, paired and repeated-measures designs remain descriptive. Exports separate technical observations, unit-level group data and design metadata. Passing software tests does not establish biological validity.

本轮验证和未完成范围见 [2026-11-08 验证记录](docs/validation-2026-11-08.md)。报告/解读来源保护仍为部分完成，未执行真实外部模型验证或独立生物学验证。

## 开发

```bash
npm install
npm run dev        # 本地开发 http://localhost:5173
npm test           # Vitest 单元测试（核心数学与解析逻辑）
npm run build      # 类型检查 + 产物构建
npx playwright test # E2E 冒烟（含一键分析与真实文件流程）
```

技术栈：Vite + React 19 + TypeScript，纯前端，无后端。运行时依赖仅 `xlsx`（SheetJS）与 `idb-keyval`。

测试数据：`tests/fixtures/` 内含 CFX / QuantStudio / LightCycler 三种风格的合成导出样本（构造数据），`tests/fixtures/real/` 内含来自公开数据集的**真实 QuantStudio 导出**（96/384 孔，见其 PROVENANCE.md），均有回归与 E2E 覆盖。

## 隐私

文件解析、计算和导出在浏览器内完成；项目数据存于本机 IndexedDB。可选 AI 解读采用用户配置的 API 地址和密钥，仅在点击“开始解读”后发送结构化分析摘要；这与本地测量流程分开。

## License

MIT
