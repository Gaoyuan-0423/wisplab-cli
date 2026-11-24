# 单仓迁移数值回归 / Monorepo numerical regression

2026-11-24 使用独立安装的旧版 CLI（`7cf6665`）及其锁定引擎作为对照。两端读取相同字节的程序生成输入，执行相同参数的 CLI 命令。BlotLens 比较独立仓库 `113976b` 与内置应用的原有 `npm run evaluate`。此记录覆盖软件行为和合成样本的算术结果。

The reference used the previous CLI and its three locked standalone engines. Both installations ran the same commands on identical generated inputs. The comparison covered complete domain outputs including warnings. The audit checked input hashes, analysis parameters and run status separately from timestamps, loopback ports and source identities.

| 用例 / Case | 两端观察值 / Result on both installations |
| --- | --- |
| WB，8 位固定背景，双泳道 / 8-bit local background | 净信号 / net signals 24,000 and 12,000. Ratios 1 and 0.5. Both lanes retained `CANDIDATES_REQUIRE_REVIEW`. |
| WB，16 位固定背景 / 16-bit local background | 净信号 / net signals 6,168,000 and 3,084,000. Ratios 1 and 0.5. Both lanes retained the review warning. |
| WB，滚动球 / 8-bit rolling-ball background | Radius 50, net signals 24,000 and 12,000. |
| IHC，H-DAB | Threshold 16, background 2, four detected nuclei, four positive nuclei, H-score 100. Positive pixel fraction 1,192/12,288. The eight drawn disks provide a reproducible segmentation example. |
| IHC，同图作对照 / same image as control | Control threshold 90. |
| IF，同强度 R/G 通道 / identical R/G intensity | Pearson 1 on all and masked pixels. Thresholds 88/88. Manders M1 and M2 both 0.9243630573248408. |
| qPCR，报告质控 / report | Treatment fold change 0.0625. Row 12 flagged and retained. NTC verdict `contaminated`. |
| qPCR，排除质控 / exclude | Treatment fold change 4. Row 12 flagged and excluded. NTC verdict `contaminated`. |
| BlotLens，独立矩形真值 / rectangular truth | Both reports passed 77 assertions, including 9 measured ROIs. Target fold estimates were [1, 1, 1] and [1, 0.25, 3]. Source hashes matched. The reports differed only in execution time. |

### qPCR 实验单位 / Experimental units

默认测试输入未确认实验单位。旧引擎报告 `unsupported`，合入的 qPCR 主线报告 `unconfirmed`。新版使用 `DESIGN_UNCONFIRMED` 描述具体原因，增加 `plate`、`sampleIds` 和 `unitId`，并在质控中标出 `plate-sample-group-target` 聚合单位。两端均给出描述性结果，样本级推断 P 值为空。质控行号、复孔离散度和 NTC 警告一致。

The newer engine reports its native experimental-unit status and sample identities. The treatment fold change, replicate QC and contamination diagnostics agree. With no confirmed design, both engines return descriptive results. The separate experimental-unit test exercises an explicitly confirmed design through the API, CLI and MCP.

### 复核 / Reproduction

The original standalone engine revisions are the top-level `revision` fields in [the engine lock](../engines.lock.json). Each bundled entry records its imported upstream revision and local Git tree. The fixture generators and analytical expectations are in [the CLI integration suite](../tests/integration/README.md). For the original BlotLens evaluation use [its documented fixture](../apps/blotlens/scripts/evaluate.ts). These tests use synthetic pixels, plate rows and human-authored mock detection shapes. Independent scientific accuracy, live AI provider behavior and production deployment are outside their scope.

```sh
npm run test:integration
npm run test:unit-engine
npm --prefix apps/blotlens run evaluate
```
