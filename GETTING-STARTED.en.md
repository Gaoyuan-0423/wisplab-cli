# Getting started with WispLab CLI and AI assistants

[中文](GETTING-STARTED.md) | **English** · [Overview](README.en.md)

This guide installs the local CLI/MCP bridge and its three analysis engines. You can run commands directly or use an AI client with terminal or MCP support.

## 1. Prepare the environment

You need Git, Node.js ≥ 22.12, npm, and macOS, Linux, or Windows WSL; check each engine repository for its specific requirements. Start with `node --version`. The examples below place all four repositories under one parent directory. Replace example paths and sample names with your own.

```sh
git clone https://github.com/Gaoyuan-0423/blot-workbench.git
git clone https://github.com/Gaoyuan-0423/pathology-workbench.git
git clone https://github.com/Gaoyuan-0423/pcr-workbench.git
git clone https://github.com/Gaoyuan-0423/wisplab-cli.git

(cd blot-workbench && npm ci)
(cd pathology-workbench && npm ci && npx playwright install chromium)
(cd pcr-workbench && npm ci)
cd wisplab-cli
```

Install development dependencies: WB/qPCR need the repository's `tsx`; IHC/IF need Vite, Playwright, and its matching Chromium version. Do not use `--omit=dev`. If an older engine revision lacks a lockfile or a required dependency, follow that engine's setup instructions; `doctor` lists missing requirements. On Linux, Chromium may require additional system libraries; follow Playwright's installation messages.

The bridge itself needs no `npm install`. Installing or upgrading dependencies accesses package servers; analysis uses local engines.

## 2. Configure and check paths

```sh
cp wisplab.config.example.json wisplab.config.json
```

Edit the config. For sibling repositories and experimental data in `~/data`, use:

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

Relative engine paths are based on the config file's directory; `~` expands to your home directory. MCP inputs, control images, and verification materials must fall within `allowPaths`, including the resolved targets of symbolic links. Add only directories you intend the tools to read.

```sh
node cli.mjs doctor
node cli.mjs --help
node cli.mjs --version
npm link                       # Optional: use wisplab instead of node cli.mjs
```

`doctor` returning `ready: true` means its checked local dependencies exist. It also records each engine's `revision` and `dirty` state. It neither updates engines nor proves numerical correctness. For multiple configurations, pass `--config /path/to/config.json` or set `WISPLAB_CONFIG`; an explicit path takes precedence.

## 3. Run a well-specified analysis

After linking the global command:

```sh
wisplab wb /path/to/blot.png --lanes 6 --bg local --control 2
wisplab ihc /path/to/section.tif --profile h_dab
wisplab if /path/to/duplex.png
wisplab pcr /path/to/plate.csv --ref GAPDH --control NC
```

Without `npm link`, run from the CLI directory and replace `wisplab` with `node cli.mjs`.

| Analysis | Information to verify | Output location |
| --- | --- | --- |
| WB | Original PNG/TIFF, lane count, dark/light signal, control lane; for multiple panels, also `--strip y,h,x0,x1` | `images[].lanes[]`: `net`, `ratio`, `warnings` |
| IHC | Stain preset and image quality; H-DAB may use `--control-tif negative.tif` | `files[].overall`, `thresholdUsed`, `warnings`, `qc` |
| IF | What the red/green channels represent; this CLI cannot change channels | `files[].coloc`: Pearson, Manders, thresholds |
| qPCR | Reference names from `Target`, control names from `Sample`, and the meaning of experimental replicates | `files[].results`, `refGenesUsed`, `controlSamples`, `warnings`, `ntcReport` |

qPCR reuses the upstream importer for CSV/TXT/TSV (UTF-8/GBK), Excel (XLSX/XLS/XLSM/XLSB), and RDML. Only the first Excel worksheet is used, with a warning for multiple worksheets. RDML-declared efficiencies are applied; explicit `--eff` values take precedence. Enter efficiencies as percentages: `--eff "LDHA=92;GAPDH=99"` means 92% and 99%, not amplification factors per cycle. The CLI exposes no interactive grouping or every upstream setting. Configurable per-well QC, replicate-SD reporting and explicit exclusions are available; report-only is the default and a subset of checks is not a complete QC pass.

Per-file analysis errors remain in JSON and set CLI exit code 1 or MCP `isError: true`. Inspect each file's `warnings` even after success. A numeric result does not establish validity if image selection, replicate design, or thresholds are unsuitable. A WB control lane with positive net signal should have a ratio of 1 to itself; ratios may be `null` when control signal is nonpositive. Review IHC nuclear-intensity H-score alongside segmentation quality.

## 4. Optional: install AI skills

`skills/` contains four skills for WB, IHC, IF, and qPCR. Review their content and follow your client's skill-directory convention. For a client using `~/.agents/skills/`:

```sh
mkdir -p ~/.agents/skills
cp -Rn skills/wisplab-* ~/.agents/skills/
```

This does not overwrite existing files with the same names. Compare and replace existing skills when updating. Reload your client, then provide a file path and analysis requirements, for example:

> Analyze /path/to/plate.csv using GAPDH and ACTB as references and C1/C2 as controls. Report fold changes, the statistical methods used, and all warnings.

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

Configuration formats vary by client. The essential setup is to launch `mcp-server.mjs` with Node and provide the absolute config path. The client should list five tools: `wb_quantify`, `ihc_quantify`, `if_colocalize`, `pcr_analyze`, and `pcr_verify`. The last requires separately obtained, trusted verification scripts and data; it is not needed for routine analysis.

Computation is local, but an AI client may transmit prompts, results, or attachments to its model service. This bridge's path checks do not determine those transfers.

## 6. Troubleshooting and updates

| Problem | Action |
| --- | --- |
| Missing config or incorrect paths | Pass an absolute `--config`; inspect resolved paths with `doctor` |
| Missing `tsx`, Vite, or Chromium | Install locked dependencies in the corresponding engine repository; for IHC also run `npx playwright install chromium` |
| IHC/IF port occupied | Change `ihc.devPort`; the program does not reuse an unknown existing service |
| MCP rejects a path | Add the data directory to `allowPaths`; check symbolic-link targets |
| WB image is JPEG only | Prefer the original PNG/TIFF; format conversion cannot undo JPEG compression errors |
| Need ROIs, reports, or overlays | Use the corresponding engine GUI; this CLI returns JSON |
| `grade` or `verify-pcr` fails | Check the separately distributed benchmark/verification scripts, data, and runtime requirements |

Before updates, save `wisplab doctor` output and analysis parameters, and inspect local changes in each repository. When a checkout is clean and appropriate to update, run `git pull --ff-only` there. Run `npm ci` after engine updates; reinstall the matching Chromium after Playwright updates. Then run bridge tests, `doctor`, and your fixed-data regression checks.

To remove the global link, run `npm unlink -g wisplab-cli`, then remove this tool's MCP configuration and skills from your client. Preserve needed configuration and local materials before deleting source directories.

[Capabilities and limits](README.en.md) · [Issues](https://github.com/Gaoyuan-0423/wisplab-cli/issues) · [Pull requests](https://github.com/Gaoyuan-0423/wisplab-cli/pulls)

质控参数与排除规则 / QC and exclusion policy: [说明 / Guide](docs/qpcr-qc.md).
