# Getting started with WispLab CLI and AI assistants

[中文](GETTING-STARTED.md) | **English** · [Overview](README.en.md)

This guide installs the local CLI/MCP bridge and its three analysis engines. You can run commands directly or use an AI client with terminal or MCP support.

If you already have an IHC result JSON and reference JSON, this repository and Node.js are enough to run `node cli.mjs ihc-validate result.json reference.json`. This offline comparison reads no engine configuration and starts no analysis engine or browser.

## 1. Prepare the environment

You need Git, Node.js ≥ 22.12, npm, and macOS, Linux, or Windows WSL; check each engine repository for its specific requirements. Start with `node --version`. The script reads `engines.lock.json` and installs pinned engines, dependencies and Chromium; `--plan` only prints the plan. Destination/config paths must be new. Replace data paths and sample names with your own.

```sh
git clone https://github.com/Gaoyuan-0423/wisplab-cli.git
cd wisplab-cli
node scripts/setup-engines.mjs --root ../wisplab-verified-engines --config ./wisplab.config.json --plan
node scripts/setup-engines.mjs --root ../wisplab-verified-engines --config ./wisplab.config.json
node cli.mjs doctor --strict
```

Install development dependencies: WB/qPCR need the repository's `tsx`; IHC/IF need Vite, Playwright, and its matching Chromium version. Do not use `--omit=dev`. If an older engine revision lacks a lockfile or a required dependency, follow that engine's setup instructions; `doctor` lists missing requirements. On Linux, Chromium may require additional system libraries; follow Playwright's installation messages.

The bridge itself needs no `npm install`. Installing or upgrading dependencies accesses package servers; analysis uses local engines.

## 2. Configure and check paths

The installer has created your config; do not overwrite it with the example. Edit its `allowPaths` for your data and review-output directories. For existing engines, create a new config from `wisplab.config.example.json`. The following example uses sibling engine repositories and `~/data`:

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

Relative engine paths are based on the config file's directory; `~` expands to your home directory. MCP inputs, control images, verification materials and `reviewDir` output directories must fall within `allowPaths`, including resolved symlink targets. Add only intended access locations.

```sh
node cli.mjs doctor
node cli.mjs --help
node cli.mjs --version
npm link                       # Optional: use wisplab instead of node cli.mjs
```

`doctor.ready` means checked dependencies exist; `verified` additionally requires three clean engine repositories matching the lock. `doctor --strict` exits nonzero when unverified and reports current/expected revisions, `matchesLock` and `dirty`. This neither updates engines nor proves scientific accuracy; see [verified engines](docs/verified-engines.md). For multiple configurations, pass `--config /path/to/config.json` or set `WISPLAB_CONFIG`; an explicit path takes precedence.

## 3. Run a well-specified analysis

After linking the global command:

```sh
wisplab wb /path/to/blot.png --lanes 6 --bg local --control 2
wisplab ihc /path/to/section.tif --profile h_dab
wisplab if /path/to/duplex.png --channels R,B
wisplab pcr-preview /path/to/plate.csv
wisplab pcr /path/to/plate.csv --ref GAPDH --control NC
```

Without `npm link`, run from the CLI directory and replace `wisplab` with `node cli.mjs`.

| Analysis | Information to verify | Output location |
| --- | --- | --- |
| WB | Original PNG/TIFF, lane count, dark/light signal, control lane; for multiple panels, also `--strip y,h,x0,x1` | `images[].lanes[]`: `net`, `ratio`, `warnings` |
| IHC | Stain preset and image quality; H-DAB may use `--control-tif negative.tif` | `files[].overall`, `thresholdUsed`, `warnings`, `qc` |
| IF | Biological meaning of the selected RGB channels; default R/G, selectable with `--channels R,B` | `files[].coloc`: Pearson, Manders, thresholds |
| qPCR | Reference names from `Target`, control names from `Sample`, and the meaning of experimental replicates | `files[].primaryAnalysis` (check `status` and `statisticalUnit` first), `refGenesUsed`, `controlSamples`, `warnings`, `ntcReport` |

qPCR reuses the upstream importer for CSV/TXT/TSV (UTF-8/GBK), Excel (XLSX/XLS/XLSM/XLSB), and RDML. Select Excel sheets by exact name with `--sheet`; omission defaults to the first sheet and warns about other sheets, without merging them. `pcr-preview` inspects source rows, mappings and issues first. `--header-row` is a 1-based physical row including blank rows; `--columns` accepts exact header names or 1-based column numbers. RDML-declared efficiencies are applied; explicit `--eff` values take precedence. Enter efficiencies as percentages: `--eff "LDHA=92;GAPDH=99"` means 92% and 99%, not amplification factors per cycle. Cq limits, absolute deviation, z-score, replicate-SD reporting and explicit exclusions are configurable; report-only is the default and a subset of checks is not a complete QC pass. Explicit grouping uses `--groups` and `--control-group`, defaulting to unpaired Welch. Add `--paired --pair-ids` only for an established paired experiment. Technical wells do not increase biological n; paired inference uses complete usable pairs. The 95% CIs are individual unadjusted intervals, while p-values separately receive Holm adjustment; see [import and paired design](docs/pcr-import-design.md). General repeated-measures models and cross-plate correction are not provided.

One reference gene is sufficient (for example `--ref GAPDH`); multiple references are optional. Read each file's `primaryAnalysis` first: `kind: biological-groups` uses explicitly declared biological samples, while `kind: well-level` uses wells. Check `status` and `error` before reading `summaries` and `comparisons`. If a requested biological analysis fails, the primary result remains a biological-group error; never substitute retained legacy `results` as biological inference. QC/NTC diagnostics can still be reviewed separately.

Per-file analysis errors remain in JSON and set CLI exit code 1 or MCP `isError: true`. Inspect each file's `warnings` even after success. A numeric result does not establish validity if image selection, replicate design, or thresholds are unsuitable. A WB control lane with positive net signal should have a ratio of 1 to itself; ratios may be `null` when control signal is nonpositive. Review IHC nuclear-intensity H-score alongside segmentation quality.

Preview the mapping, then analyze with the same options. Row/column positions are 1-based; the worksheet option is a name:

```sh
wisplab pcr-preview plate.xlsx --sheet Results --header-row 7 --columns '{"sample":1,"target":2,"cq":5}'
wisplab pcr plate.xlsx --sheet Results --header-row 7 --columns '{"sample":1,"target":2,"cq":5}' --ref GAPDH --control C1,C2
```

IHC accepts hash-bound source-pixel rectangular ROIs through `--roi-manifest rois.json`. `--mpp 0.5` means source µm/px and should only be supplied for a known scale. `--nuclei` exports model-derived centers; `--review-dir` creates local PNG/HTML and full result JSON. IF supports RGB channel selection and review export, but no ROI import. Overlays show positive stain/channel signal, not nucleus outlines. See [image review](docs/image-review.md).

```sh
mkdir -p ./reviews
wisplab ihc section.png --nuclei --review-dir ./reviews > result.json
wisplab ihc-annotation-pack result.json --images-root . --output-dir ./reviews
# After independent annotation; 8 is an example preselected source-pixel radius
wisplab ihc-nuclei-validate result.json nuclei-reference.json --match-radius 8
```

The last two commands are offline and need no engine configuration. Packs embed original PNG/JPEG only and exclude model-predicted points. They support saved/resumed drafts and an optional independently assessed H-score, never inferred from binary labels. Spatial comparison reports one-to-one detection and matched-nucleus classification, without Dice/IoU. `compared` means completion, not acceptable accuracy. **Real human-reference accuracy validation remains pending independent annotation.** See [nucleus annotation and comparison](docs/ihc-nuclei-validation.md).

Default deadlines are 300000 ms per batch and 120000 ms per IHC/IF image; adjust them with `--timeout-ms` / `--file-timeout-ms`. CLI progress uses stderr and Ctrl-C cancels; MCP progress requires a token, while ping and cancellation remain responsive. IHC image timeouts preserve earlier results and restart for later images; a batch timeout ends unfinished work. Ordinary WB image failures preserve other successes; forced interruption of WB/qPCR may occur before complete JSON exists. See [runtime controls](docs/runtime-controls.md).

## 4. Optional: install AI skills

`skills/` contains four skills for WB, IHC, IF, and qPCR. Review their content and follow your client's skill-directory convention. For a client using `~/.agents/skills/`:

```sh
mkdir -p ~/.agents/skills
cp -Rn skills/wisplab-* ~/.agents/skills/
```

This does not overwrite existing files with the same names. Compare and replace existing skills when updating. Reload your client, then provide a file path and analysis requirements, for example:

> Analyze /path/to/plate.csv using GAPDH as the reference and C1/C2 as controls. Report fold changes, the statistical methods used, and all warnings.

> Quantify the target panel in /path/to/blot.png: six lanes, exclude the marker on the left, use lane 2 as control, and rolling-ball radius 50.

The assistant must use actual output and must not invent missing controls, reference genes, measurements, or statistical results.

## 5. Optional: connect MCP

For a client using a `mcpServers` configuration:

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

Configuration formats vary by client. The essential setup is to launch `mcp-server.mjs` with Node and provide the absolute config path. The client should list six tools: `wb_quantify`, `ihc_quantify`, `if_colocalize`, `pcr_preview`, `pcr_analyze`, and `pcr_verify`. The last requires separately obtained, trusted verification scripts and data; it is not needed for routine analysis.

Computation is local, but an AI client may transmit prompts, results, or attachments to its model service. This bridge's path checks do not determine those transfers.

## 6. Troubleshooting and updates

| Problem | Action |
| --- | --- |
| Missing config or incorrect paths | For analysis commands, pass an absolute `--config` and inspect paths with `doctor`. Offline `ihc-validate` needs no config |
| Missing `tsx`, Vite, or Chromium | Install locked dependencies in the corresponding engine repository; for IHC also run `npx playwright install chromium` |
| IHC/IF port occupied | Change `ihc.devPort`; the program does not reuse an unknown existing service |
| MCP rejects a path | Add the intended data or review-output directory to `allowPaths`; check symlink targets |
| WB image is JPEG only | Prefer the original PNG/TIFF; format conversion cannot undo JPEG compression errors |
| Need ROIs, reports, or overlays | IHC uses `--roi-manifest`; IHC/IF use `--review-dir`. IF ROI and WB image export remain unsupported |
| `grade` or `verify-pcr` fails | Check the separately distributed benchmark/verification scripts, data, and runtime requirements |

Before updates, retain doctor output, result JSON and parameters. Pinned installs use detached revisions: after updating the bridge, rerun the installer with new destination/config paths for its new lock, then run `doctor --strict` and fixed-data regressions. Manually managed engines may be upgraded separately but may no longer match the lock; reinstall dependencies/matching Chromium and recheck. Do not equate `ready` with `verified`.

To remove the global link, run `npm unlink -g wisplab-cli`, then remove this tool's MCP configuration and skills from your client. Preserve needed configuration and local materials before deleting source directories.

[Capabilities and limits](README.en.md) · [Issues](https://github.com/Gaoyuan-0423/wisplab-cli/issues) · [Pull requests](https://github.com/Gaoyuan-0423/wisplab-cli/pulls)

质控参数与排除规则 / QC and exclusion policy: [说明 / Guide](docs/qpcr-qc.md).

单个内参即可进行 qPCR 分析（例如 `--ref GAPDH`）；多个内参为可选功能。 / One reference gene is sufficient (for example `--ref GAPDH`); multiple reference genes are optional.
