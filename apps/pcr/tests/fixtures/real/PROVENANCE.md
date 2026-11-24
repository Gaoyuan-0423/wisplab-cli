# 真实仪器导出文件来源

本目录下的文件为**真实仪器软件导出的公开数据**，仅用作解析管线的回归测试（`src/core/real-files.test.ts`）。

| 文件 | 来源 | 说明 |
| --- | --- | --- |
| `2019-04-25_124559-GAPDH.csv` | [neuroeddu/Auto-qPCR](https://github.com/neuroeddu/Auto-qPCR) `Example_Data/Absolute/` | Thermo QuantStudio 96 孔导出，带约 25 行元数据头（MIT 许可） |
| `2019-04-26_161050-GRIA1.csv` | 同上 | Thermo QuantStudio 96 孔导出（MIT 许可） |
| `RELATIVE_example.csv` | 同上 `Example_Data/RELATIVE_example.csv` | Thermo QuantStudio **384 孔**导出（MIT 许可） |
| `stepone_std.rdml` | CRAN RDML R 包（GPL-3）`inst/extdata` | **真实 RDML 1.0**（StepOne 导出）：标准品带 quantity、NTC、靶标声明效率 93.9% |
| `lc96_bACTXY.rdml` | 同上 | **真实 RDML 1.1**（Roche LightCycler 96）：UUID 样本/run id、384 反应 |
| `BioRad_qPCR_melt.rdml` | 同上 | **真实 RDML 1.1**（Bio-Rad）：带前缀命名空间、ntc 样本 |
| `multi_run.rdml` / `wt_mt.rdml` / `qiagen_rotor_gene.rdml` | [Q-Prism-SNP-visualizer](https://github.com/Key-man-fromArchive/Q-Prism-SNP-visualizer) 测试固件 | 合成最小 RDML（无 Cq，仅结构参考） |

| `MeltingCurvesLorenzo.csv` | [derele/Mouse_Eimeria_Field](https://github.com/derele/Mouse_Eimeria_Field)（公开科研数据） | **真实 LightCycler 熔解摘要表**（每孔峰值数 No. Tm + Tm 值），供熔解摘要表格式支持参考 |

注：三个真实 `.rdml` 来自 GPL-3 许可的 RDML R 包随附的仪器导出示例数据，本仓库仅用作解析器回归测试。

这些文件中的实验数据本身是公开数据集的一部分，按上游仓库的 MIT 许可随本仓库分发。若要补充其他仪器（CFX / LightCycler / Rotor-Gene）的真实导出样本，请确认许可后放入本目录并在此登记。
