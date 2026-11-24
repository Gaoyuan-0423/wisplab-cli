# AGENTS.md — pcr-workbench（qPCR）

面向 AI agent 在本仓库工作的约定。验证基准与独立参考：`~/Downloads/WispLab预印本验证/pcr/`（`README.md`、`reference_check.py`、`dump_app.ts`）。

## 结构

- `src/core/` — **纯函数引擎**（node 可测）：`analysis.ts`（`sniff` 表头识别 → `extractRows` → `analyzeDeltaDeltaCt`：复孔聚合、多内参池化、个体 ΔCt、Livak/Pfaffl、Welch/ANOVA+Dunnett）、`stats.ts`、`sniff.ts`、`rdml.ts`、`melt.ts`、`ntc.ts`、`qc.ts`、`standard.ts`（标准曲线效率）、`pzfx.ts`、`export/chart-*`。
- `tests/fixtures/real/` — 真实仪器导出（Auto-qPCR MIT 语料 + RDML R 包 GPL 示例；出处见该目录 PROVENANCE.md），`real-files.test.ts` 保证解析不回退。

## 调用约定

```ts
const r = sniff(matrix);
const rows = extractRows(matrix.slice(r.headerRow + 1), r.mapping);
const out = analyzeDeltaDeltaCt(rows, {
  refGenes: ["GAPDH"], controlSamples: ["C1"],
  efficiencies: { 目标: 92 },   // 百分比；全 100 = Livak
  qc: { minCq: NaN, maxCq: NaN, absDev: NaN, repSD: NaN }, // NaN = 不启用
});
```

- `efficiencies` 任一参与基因非 100 自动切换效率校正：各内参先使用自身效率计算相对量，再取几何均值作分母；不能先平均内参效率。单内参即 Pfaffl，全部效率为 100 时保留 Livak 路径。One reference is sufficient; multiple references remain optional.
- 统计：≥3 处理泳道走 ANOVA+Dunnett，否则 Welch t；统计一律在个体 ΔCt 值上做。

## ⚠ stats.ts Dunnett 求积——不要回退

`dunnettAdjustedP` 曾因"卡方分位数坐标 + 40 节点固定求积"在深尾部（|t|≳30）把校正 p 算小 6 个数量级（真实数据实测 6.9e-13 vs 正确 ≈3e-6）。**2026-10-17 已修复**（commit 4142b60：χ² 变量域逐比较自适应截断 + 直接积分尾部），并带真实数据回归测试。改这段代码前先读 `stats.test.ts` 深尾部用例；跨实现对照脚本在 `~/Downloads/WispLab预印本验证/pcr/reference_check.py`（通过线：深尾部落在 [raw p, k·raw p] 区间且与参考求积一致 ≤2%）。

## 其他纪律

- 界面文案/导出**中英同步**（`src/i18n/`）。
- 新解析格式先在 `tests/fixtures/real/` 放真实样本并登记 PROVENANCE.md，再写解析回归。
- LICENSE 为 MIT；投稿归档时核对依赖许可。
- 发布走 blot-workbench 仓库的统一发布器，需所有者确认；本仓库 main 推送只触发 CI。
- `npm test`（148+ 用例）必须全绿。
