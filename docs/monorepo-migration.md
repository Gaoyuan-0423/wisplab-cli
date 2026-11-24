# WispLab source migration

The single-repository entry point is [Getting started](../GETTING-STARTED.en.md). 单仓安装与使用见[中文上手指南](../GETTING-STARTED.md)。维护四个应用时，在同一提交中更新对应的测试和使用说明。

| Code in this repository | Original public source | Initial verified CLI pin | Imported main |
| --- | --- | --- | --- |
| CLI and MCP | wisplab-cli | — | `7cf6665` |
| `apps/wb` | blot-workbench | `fd867d8` | `5615e0b` |
| `apps/pathology` | pathology-workbench | `10e7465` | `79df134` |
| `apps/pcr` | pcr-workbench | `d78857e` | `d4e8291` |
| `apps/blotlens` | blotlens | — | `113976b` |

Four subtree imports preserve the public Git ancestry. Three subsequent subtree merges update the CLI engines individually. The numerical comparisons and synthetic inputs are described in [migration regression results](migration-regression.md). The embedded screenshot workflow ports the host integration from [WB #3](https://github.com/Gaoyuan-0423/blot-workbench/pull/3), using the bundled BlotLens source.

## Open work recorded at migration

The following source changes were still under review on 2026-11-24. These links identify the original proposals for future review in the unified repository.

- WB project replay and machine-readable ratios. [CLI #36](https://github.com/Gaoyuan-0423/wisplab-cli/pull/36)
- Cross-module validation documents. [WB #21](https://github.com/Gaoyuan-0423/blot-workbench/pull/21)
- Result validity and independent-unit inference for pathology and IF. [Pathology #6](https://github.com/Gaoyuan-0423/pathology-workbench/pull/6)
- Interpretation provenance after restoring a qPCR project. [PCR #14](https://github.com/Gaoyuan-0423/pcr-workbench/pull/14)

## Existing projects

An offline Chromium rehearsal exported synthetic projects from the 20261025-apple-privacy release and imported them in the unified apps. The WB example retained six image hashes, its ROIs and all six rows of the exported CSV. The H-DAB example retained its ROI, two attachment hashes and whole-image measurements. The qPCR example retained the source file hash, six sample rows, Cq, ΔCt, ΔΔCt, fold changes and technical standard deviations. Current qPCR displays fold change and technical SD in separate columns and uses confirmed experimental units for group inference.

The old Pages export window starts when an operator deploys the migration notice to all three old sites after acceptance of the new sites. The code merge itself does not start the 30-day period. Operational instructions are in [the deployment directory](../apps/wb/deployment/wisplab/).
