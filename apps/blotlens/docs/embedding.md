# WB 内嵌 / Embedding in WB

WB 打包时从仓库内的 BlotLens 源码构建 iframe 页面，路径为 WB 入口下的 `./blotlens/index.html`。
WB 首页及项目导航中的「截图趋势核对」打开工作区。通过哈希导航离开再返回时，当前截图及 ROI 仍在页面内存中。刷新或关闭前请导出独立的 BlotLens 分析 JSON。WB 实验项目保持其原有格式，截图趋势不参与独立重复统计。

The WB host and frame use the same origin. The host accepts version 1 messages only from its frame; the frame accepts them only from its direct parent. No provider request is made when an image arrives. On first opening, the frame follows the WB language.

| Message | Payload |
| --- | --- |
| `blotlens:ready` | Frame ready for messages |
| `blotlens:language` | Host sends `language` (`zh` or `en`) |
| `blotlens:import-image` | Host sends `requestId`, `name`, `mimeType` (PNG/JPEG) and original `bytes` (ArrayBuffer, 1 byte to 15 MiB) |
| `blotlens:import-result` | Frame sends the matching `requestId` and `ok` |
| `blotlens:state` | Frame sends `hasAnalysis` for the host's navigation guard |

The iframe uses its page-relative `./api/` endpoint. With the local WB server (`npm run local`) this reaches a separate loopback-only BlotLens handler. On the WB production domain a separate hosted instance uses request-scoped credentials. On GitHub Pages and the offline desktop app, manual review, synthetic examples and export work without an API. Standalone and hosted deployment details are in [deployment](../deploy/README.md).
