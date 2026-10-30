# wisplab-cli

[中文](README.md) | **English** · [Getting started](GETTING-STARTED.en.md) · [中文上手指南](GETTING-STARTED.md)

A local CLI and MCP interface for **Western blot, IHC/histology, two-channel immunofluorescence colocalization, and qPCR**. It calls analysis code from your configured WispLab repositories so scripts and AI assistants can use the same engines and receive JSON results.

**中文：** WispLab 的本地命令行与 MCP 接口，复用三个分析引擎，为脚本和 AI 助手提供 WB、组织染色、IF 共定位和 qPCR 定量。[阅读完整中文介绍 →](README.md)

## Capabilities

| Command | Engine | Exposed capabilities |
| --- | --- | --- |
| `wb` | [blot-workbench](https://github.com/Gaoyuan-0423/blot-workbench) | PNG/TIFF lane proposals, a specified panel strip, local or rolling-ball background subtraction, dark/light signal, net-signal ratios against a control lane |
| `ihc` | [pathology-workbench](https://github.com/Gaoyuan-0423/pathology-workbench) | Whole-image H-DAB, H&E, and Masson analysis; positive area, nuclei counts, nuclear-intensity H-score, thresholds and QC; negative-control calibration for H-DAB |
| `if` | Same as above | Pearson, thresholded Pearson, and Manders M1/M2 using the default red/green channels |
| `pcr` | [pcr-workbench](https://github.com/Gaoyuan-0423/pcr-workbench) | Table/RDML import, multiple-reference normalization, ΔΔCt/Pfaffl fold changes, NTC reports, and engine-provided statistics |
| `doctor` | Local environment | Config location, engine paths, Git revisions, uncommitted changes, and runtime dependency checks |

CLI and MCP share `lib.mjs`. WB/qPCR use each engine repository's `tsx`; IHC/IF call the browser engine through local Vite and Playwright Chromium. **The bridge itself has no npm runtime dependencies**, but the engines and Chromium must be installed separately. It runs the configured local revisions: updating this repository does not update the engines automatically.

## Quick start

Requires Git, Node.js ≥ 22.12, and the runtime requirements of the three engines. See [Getting started](GETTING-STARTED.en.md) for dependency installation and AI client setup.

```sh
git clone https://github.com/Gaoyuan-0423/wisplab-cli.git
cd wisplab-cli
cp wisplab.config.example.json wisplab.config.json
# Edit the config with the paths of your installed engine repositories
node cli.mjs doctor
node cli.mjs --help
npm link                 # Optional: enable the wisplab command
```

```sh
# WB: six lanes in a manually selected panel strip, control lane 1
wisplab wb blot.png --strip "140,85,160,350" --lanes 6 --bg rolling:50 --control 1

# qPCR: names must match the table; efficiencies are percentages
wisplab pcr plate.csv --ref GAPDH,ACTB --control C1,C2
wisplab pcr plate.csv --ref GAPDH --control C1 --eff "LDHA=92;GAPDH=99"

# IHC: control calibration is H-DAB only; IF: default red/green channels
wisplab ihc section.tif --profile h_dab --control-tif negative.tif
wisplab if duplex.png
```

`--strip y,h,x0,x1` uses original image pixels: `h` is the height and `x1` the right boundary. Include background margins and exclude markers, labels, and other panels. For WB, `--control` is a lane number starting at 1; for qPCR, it is a comma-separated list of sample names. Per-file analysis errors set CLI exit code 1 or MCP `isError: true`, while retaining JSON results. Inspect `warnings` even after successful execution.

## Configuration

Precedence: `--config <path>` → `WISPLAB_CONFIG` → `wisplab.config.json` in the current directory → the same file in the CLI directory. A missing explicitly selected config is an error. The `repos` and `allowPaths` values support `~`; relative paths are resolved against the config file's directory.

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

`allowPaths` restricts **MCP tool input paths**, including control images and verification materials, using resolved real paths to check symbolic links. Direct local CLI execution does not apply this MCP restriction. IHC/IF start Vite on `127.0.0.1` only; change `ihc.devPort` if the port is occupied.

## MCP and AI skills

Five tools are available: `wb_quantify`, `ihc_quantify`, `if_colocalize`, `pcr_analyze`, and `pcr_verify`. Transport is stdio; IHC/IF calls wait for analysis to finish before returning results. The server supports 2026-07-28 `server/discover` and request metadata, while retaining `initialize` negotiation for older clients.

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

Four optional AI skills are included in [`skills/`](skills/). Installation is covered in [Getting started](GETTING-STARTED.en.md). An AI assistant can translate natural-language requests into commands, but still needs correct reference genes, controls, image channels, and experimental design information.

Analysis runs locally. Your AI client may send tool results, prompts, or attached images to its model provider. MCP path restrictions do not control the client's data transfers; manage these through your client settings.

## Checking, updating, and reproducing results

See the [2026-10-30 verification report](docs/validation-2026-10-30.md) and [CHANGELOG](CHANGELOG.md) for this update and its actual validation scope.

```sh
npm test
npm run check
wisplab doctor > environment.json
```

`doctor` checks local dependencies and revisions; it does not fetch the latest upstream state or validate scientific accuracy. Before updating engines, save the current Git revisions, inputs, and parameters, and review each repository's changes. Reinstall locked dependencies after updating, then rerun diagnostics and your reference-data regression checks.

The original README's 2026-10-18 M1/M3/M4 numbers were historical validation records tied to particular data, parameters, and engine versions. They do not demonstrate calibration of every current version. This repository's automated tests check bridge behavior; numerical agreement requires fixed inputs and the corresponding engine validation materials.

`wisplab verify-pcr /path/to/validation` requires separately obtained, trusted `dump_app.ts`, `reference_check.py`, their data, and a Python environment; it executes those scripts. `wisplab grade <pcr|ihc|wb|synthetic16> submission.json` requires the adjacent `../wisplab-benchmark/grade.mjs` and its benchmark materials. Neither set of materials is bundled here.

## Current limits

- WB reports ratios to a specified lane. It does not automatically perform target/loading-control normalization across images. Use original PNG/TIFF files; converting JPEG to TIFF cannot recover information lost through compression.
- IHC/IF use whole-image defaults. The bridge does not expose the upstream GUI's manual ROIs, scale calibration, all segmentation settings, or model selection. Nuclear-intensity H-score is not a universal clinical marker score; without scale calibration, per-mm² density cannot be meaningfully reported.
- The pathology engine downsamples images with a side longer than 4096 pixels and converts 16-bit TIFF to 8-bit working pixels. WB has a separate 8/16-bit image workflow.
- IF uses the engine's default R/G channels and exposes no channel-selection parameter. The upstream GUI offers additional controls. Verify the meaning of channels in pseudocolor images.
- qPCR reuses the upstream importer, but exposes no interactive grouping or every upstream setting. Per-well QC, replicate-SD reporting and explicit exclusions are configurable; report-only is the default. Excel uses the first worksheet only. Supported formats are listed in [Getting started](GETTING-STARTED.en.md).
- Analysis commands return JSON, without overlay images or full experiment reports. Use the corresponding engine GUI for visual review.

Track problems and changes through [Issues](https://github.com/Gaoyuan-0423/wisplab-cli/issues) and [Pull requests](https://github.com/Gaoyuan-0423/wisplab-cli/pulls). See [LICENSE](LICENSE).

质控参数与排除规则 / QC and exclusion policy: [说明 / Guide](docs/qpcr-qc.md).

分析追溯 / Analysis provenance: [格式与边界 / Format and limits](docs/provenance.md).

真实引擎回归 / Real-engine regression: [安装、固定版本与合成数据 / Setup, pinned revisions and fixtures](tests/integration/README.md).

单个内参即可进行 qPCR 分析（例如 `--ref GAPDH`）；多个内参为可选功能。 / One reference gene is sufficient (for example `--ref GAPDH`); multiple reference genes are optional.

生物学分组 / Biological groups: [Guide](docs/qpcr-groups.md).

IHC 参考值与本地厂商图复核 / Reference comparisons and local vendor checks: [Guide](docs/ihc-validation.md).
