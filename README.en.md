# wisplab-cli

[中文](README.md) | **English** · [Getting started](GETTING-STARTED.en.md) · [中文上手指南](GETTING-STARTED.md)

A local CLI and MCP interface for **Western blot, IHC/histology, two-channel immunofluorescence colocalization, and qPCR**. It calls analysis code from your configured WispLab repositories so scripts and AI assistants can use the same engines and receive JSON results.

**中文：** WispLab 的本地命令行与 MCP 接口，复用三个分析引擎，为脚本和 AI 助手提供 WB、组织染色、IF 共定位和 qPCR 定量。[阅读完整中文介绍 →](README.md)

## Capabilities

| Command | Engine | Exposed capabilities |
| --- | --- | --- |
| `wb` | [blot-workbench](https://github.com/Gaoyuan-0423/blot-workbench) | PNG/TIFF lane proposals, a specified panel strip, local or rolling-ball background subtraction, dark/light signal, net-signal ratios against a control lane |
| `ihc` | [pathology-workbench](https://github.com/Gaoyuan-0423/pathology-workbench) | Whole-image and hash-bound ROI H-DAB/H&E/Masson analysis; positive area, nuclei/H-score, mpp, nucleus export and local PNG/HTML review; H-DAB negative-control calibration |
| `if` | Same as above | Pearson, thresholded Pearson, Manders M1/M2 and overlays for two selected RGB channels (default R/G) |
| `pcr` | [pcr-workbench](https://github.com/Gaoyuan-0423/pcr-workbench) | Selectable sheet/header/columns; single-reference normalization (multiple references optional), ΔΔCt/Pfaffl, QC/NTC, explicit paired/unpaired groups and individual 95% intervals |
| `pcr-preview` | qPCR engine | Parse-only inspection of worksheets, source rows, column mappings and issues |
| `ihc-annotation-pack` / `ihc-nuclei-validate` | Offline local tools | Original-image annotation packs, resumable drafts, one-to-one nucleus matching and optional independent H-score errors |
| `ihc-validate` | Offline JSON comparison | Hash-bound comparison of existing IHC results and reference counts, H-score or positive area; no engine config needed |
| `doctor` | Local environment | Separate dependency `ready` and locked-revision `verified` states; `--strict` fails when unverified |

CLI and MCP share `lib.mjs`. WB/qPCR use each engine repository's `tsx`; IHC/IF call the browser engine through local Vite and Playwright Chromium. **The bridge itself has no npm runtime dependencies**, but the engines and Chromium must be installed separately. It runs the configured local revisions: updating this repository does not update the engines automatically.

## Quick start

Requires Git, Node.js ≥ 22.12, and the runtime requirements of the three engines. See [Getting started](GETTING-STARTED.en.md) for dependency installation and AI client setup.

```sh
git clone https://github.com/Gaoyuan-0423/wisplab-cli.git
cd wisplab-cli
node scripts/setup-engines.mjs --root ../wisplab-verified-engines --config ./wisplab.config.json
node cli.mjs doctor --strict
node cli.mjs --help
npm link                 # Optional: enable the wisplab command
```

```sh
# WB: six lanes in a manually selected panel strip, control lane 1
wisplab wb blot.png --strip "140,85,160,350" --lanes 6 --bg rolling:50 --control 1

# qPCR: inspect parsing first; names must match the table
wisplab pcr-preview plate.csv
wisplab pcr plate.csv --ref GAPDH --control C1,C2
wisplab pcr plate.csv --ref GAPDH --control C1 --eff "LDHA=92;GAPDH=99"

# IHC: export nucleus centers and local review images
mkdir -p ./reviews
wisplab ihc section.tif --profile h_dab --nuclei --review-dir ./reviews
wisplab if duplex.png --channels R,B --review-dir ./reviews

# Compare existing IHC results and references offline; no engine setup needed
wisplab ihc-validate result.json reference.json
```

The installer reads `engines.lock.json`, installs pinned revisions and dependencies into a new directory, and creates a new configuration. It refuses existing destinations/configs. Existing engines may still be configured manually; see [verified installation](docs/verified-engines.md).

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

`allowPaths` restricts **MCP input paths and image-review output directories**, including control images and verification materials, using resolved real paths to check symbolic links. Direct local CLI execution does not apply this MCP restriction. IHC/IF start Vite on `127.0.0.1` only; change `ihc.devPort` if the port is occupied.

## MCP and AI skills

`ihc-validate` is a standalone local CLI command and does not read `wisplab.config.json` or `WISPLAB_CONFIG`. Its `ungraded` status means comparison completed, not validation passed.

Six tools are available: `wb_quantify`, `ihc_quantify`, `if_colocalize`, `pcr_preview`, `pcr_analyze`, and `pcr_verify`. Transport is stdio; IHC/IF calls wait for analysis to finish before returning results. The server supports 2026-07-28 `server/discover` and request metadata, while retaining `initialize` negotiation for older clients.

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

See the linked guides and [CHANGELOG](CHANGELOG.md) for 0.8 capabilities and limits. The [2026-10-30 report](docs/validation-2026-10-30.md) remains a historical record. Real human-reference IHC accuracy validation is pending independent annotation; synthetic tests and vendor-image regressions cannot replace it.

```sh
npm test
npm run check
wisplab doctor > environment.json
```

`doctor` separates dependency readiness from clean locked-revision verification; `doctor --strict` requires `verified: true`. It does not fetch the latest upstream state or validate scientific accuracy. Before updating engines, save the current Git revisions, inputs, and parameters, and review each repository's changes. Reinstall locked dependencies after updating, then rerun diagnostics and your reference-data regression checks.

The original README's 2026-10-18 M1/M3/M4 numbers were historical validation records tied to particular data, parameters, and engine versions. They do not demonstrate calibration of every current version. This repository's automated tests check bridge behavior; numerical agreement requires fixed inputs and the corresponding engine validation materials.

`wisplab verify-pcr /path/to/validation` requires separately obtained, trusted `dump_app.ts`, `reference_check.py`, their data, and a Python environment; it executes those scripts. `wisplab grade <pcr|ihc|wb|synthetic16> submission.json` requires the adjacent `../wisplab-benchmark/grade.mjs` and its benchmark materials. Neither set of materials is bundled here.

## Current limits

- WB reports ratios to a specified lane. It does not automatically perform target/loading-control normalization across images. Use original PNG/TIFF files; converting JPEG to TIFF cannot recover information lost through compression.
- IHC accepts source-pixel rectangular ROI manifests, `--mpp` and `--nuclei`; not all segmentation controls or model selection are exposed. IF remains whole-image and does not support ROI import. Nuclear-intensity H-score is not a universal clinical score; meaningful per-mm² density requires a trustworthy mpp.
- The pathology engine downsamples images with a side longer than 4096 pixels and converts 16-bit TIFF to 8-bit working pixels. WB has a separate 8/16-bit image workflow.
- IF selects two distinct RGB channels with options such as `--channels R,B`; the default is R/G. Arbitrary spectral channels and manual thresholds are not exposed. Verify channel meaning in pseudocolor images.
- qPCR biological designs remain single-file: unpaired Welch or explicit `--paired --pair-ids` complete-pair t-tests. Pairing is never inferred; general repeated-measures models and cross-plate correction are not provided. Individual 95% intervals are unadjusted; p-values separately receive Holm adjustment. Prefer `primaryAnalysis` and never replace a failed group analysis with well-level results. Excel sheets can be selected by name; omission defaults to the first sheet, without merging.
- IHC/IF can export local PNG, HTML and result JSON. Overlays show positive stain/channel signal, not nucleus contours; WB visual review still uses its GUI. Original-image browser annotation packs support PNG/JPEG; TIFF needs an external workflow respecting the coordinate/hash contract. Spatial comparison does not provide Dice/IoU; `compared` means comparison completed, not acceptable accuracy.

Default execution limits are 5 minutes per batch and 2 minutes per IHC/IF image, configurable with `--timeout-ms` / `--file-timeout-ms`. Progress uses stderr; MCP sends progress only for a supplied token, supports cancellation, and keeps ping responsive. See [runtime controls](docs/runtime-controls.md) for partial results and cleanup boundaries.

Track problems and changes through [Issues](https://github.com/Gaoyuan-0423/wisplab-cli/issues) and [Pull requests](https://github.com/Gaoyuan-0423/wisplab-cli/pulls). See [LICENSE](LICENSE).

质控参数与排除规则 / QC and exclusion policy: [说明 / Guide](docs/qpcr-qc.md).

分析追溯 / Analysis provenance: [格式与边界 / Format and limits](docs/provenance.md).

真实引擎回归 / Real-engine regression: [安装、固定版本与合成数据 / Setup, pinned revisions and fixtures](tests/integration/README.md).

单个内参即可进行 qPCR 分析（例如 `--ref GAPDH`）；多个内参为可选功能。 / One reference gene is sufficient (for example `--ref GAPDH`); multiple reference genes are optional.

生物学分组 / Biological groups: [Guide](docs/qpcr-groups.md).

0.8.1 correctness fixes: [Per-gene efficiency and missing-result boundaries](docs/pcr-correctness.md). Single-reference analysis remains supported.

IHC 参考值与本地厂商图复核 / Reference comparisons and local vendor checks: [Guide](docs/ihc-validation.md).

0.8 使用说明 / 0.8 guides: [导入与配对 / Import and pairing](docs/pcr-import-design.md) · [图像 ROI 与复核 / Image review](docs/image-review.md) · [独立核标注 / Independent annotations](docs/ihc-nuclei-validation.md) · [时限与取消 / Runtime controls](docs/runtime-controls.md) · [锁定引擎安装 / Verified engines](docs/verified-engines.md).
