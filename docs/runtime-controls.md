# 运行时限、取消和批量进度 / Runtime limits, cancellation and batch progress

CLI 与 MCP 的分析任务由独立工作进程执行。默认整批时限为 300000 ms（5 分钟）；IHC/IF 的默认单图时限为 120000 ms（2 分钟）。时限必须为 1–2147483647 的整数毫秒，不能用 0 禁用。时限从任务实际开始执行时计时，不包含 MCP 队列等待或 IHC 运行前后的文件追溯摘要；IHC 的整批时限包含引擎启动、图像分析和正常资源清理，单图时限从读取/解码该图前开始。终止后的强制清理最多另等待约 500 ms。

CLI and MCP analysis jobs execute in isolated worker processes. The default batch deadline is 300000 ms (5 minutes); the default IHC/IF image deadline is 120000 ms (2 minutes). Values must be integer milliseconds from 1 to 2147483647; zero does not disable a deadline. Deadlines start when execution begins, excluding the MCP queue and IHC provenance fingerprinting before/after analysis. The IHC batch deadline includes startup, image analysis and normal cleanup; an image deadline starts before reading/decoding that image. Forced termination adds an approximately 500 ms cleanup grace period.

```sh
wisplab ihc a.tif b.tif c.tif --timeout-ms 600000 --file-timeout-ms 90000 > result.json
wisplab if image.tif --timeout-ms 300000 --file-timeout-ms 60000 > result.json
wisplab wb blot.png --timeout-ms 600000 > result.json
wisplab pcr plate.csv --ref GAPDH --control C1 --timeout-ms 300000 > result.json
```

进度写入 CLI 的 stderr，stdout 保持 JSON。IHC/IF 按完成图数报告；WB/qPCR 报告整批开始与结束，不估计剩余时间。Ctrl-C 或 SIGTERM 会取消 CLI 分析并终止其工作进程和子进程。退出码非零表示分析未完整成功，仍应保存可用的错误/部分结果。

CLI progress goes to stderr, leaving stdout as JSON. IHC/IF report completed-image counts; WB/qPCR report batch start and completion without estimating time remaining. Ctrl-C or SIGTERM cancels CLI analysis and stops its worker and child processes. A nonzero exit status means the analysis did not fully succeed; retain any available error or partial-result JSON.

IHC/IF 的分析前后追溯使用异步文件流和可取消的 Git 检查，因此大文件或慢 Git 不会阻塞 MCP 心跳和取消。若分析结束后的追溯被取消，已完成图像仍保留，未完成的 hash/源码检查明确标为未验证，顶层返回 `CANCELLED`。配置在任务开始时固定为已解析快照；长驻 MCP 不会因配置文件被改写或删除而换用其他引擎，IHC 超时重启也继续使用同一引擎路径和端口。要启用新配置，请重启 MCP 服务。

IHC/IF provenance uses asynchronous file streams and cancellable Git checks before and after analysis, keeping MCP ping and cancellation responsive during large-file or slow-Git checks. If final tracing is cancelled, completed images remain available, incomplete hash/source checks are explicitly unverified, and the result carries `CANCELLED`. Each job uses a resolved configuration snapshot. Editing or deleting its source file cannot change a persistent MCP server's engines, and IHC timeout restarts retain the same engine path and port. Restart the MCP server to apply new configuration.

## 批量结果 / Batch results

- WB 单图读取、解码、裁剪或测量失败时，保留该图的 `error` 和其他图的结果，继续处理后续图。CLI 返回非零退出码；MCP 设置 `isError: true`。
- IHC/IF 单图超时时，终止该工作进程与浏览器，保留此前完成的结果，给超时图记录 `error`，随后用新进程继续剩余图。正常批次复用同一浏览器。对照片超时或初始化失败会结束整批，因为其后分析所需条件没有建立。
- 整批超时或取消时，保留已完成的 IHC/IF 图像结果，其余图标记失败。顶层 `error` 也会记录启动、取消或收尾失败；即使全部图已经计算完成，收尾超时仍不会报告整体成功。`runtime` 记录执行时限和 IHC/IF 的取消标志。
- WB and qPCR keep their synchronous shared-library API; CLI/MCP use a worker around that API. Their batch deadline/cancellation can stop the worker before its final JSON exists, so interrupted batches may only return a job error. Normal WB per-image failures retain all other image results.

For IHC/IF, an image timeout terminates the worker and browser, preserves completed results, records that image's error, and starts a fresh worker for remaining images. Normal batches reuse one browser. Control-image timeout or initialization failure ends the batch. Batch timeout/cancellation preserves finished images and marks remaining images as failures. A top-level `error` includes startup, cancellation or cleanup failure; a cleanup timeout cannot be reported as overall success even if image calculations finished. `runtime` records deadlines and the IHC/IF cancellation flag.

## MCP 合同 / MCP contract

All analysis tools accept an optional `runtime.timeoutMs`. `ihc_quantify` and `if_colocalize` also accept `runtime.fileTimeoutMs`. Runtime controls are separate from scientific parameters. Only requests supplying a string/integer `_meta.progressToken` receive `notifications/progress`, with the original token and strictly increasing progress. No progress token means no unsolicited progress notifications.

```json
{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"ihc_quantify","arguments":{"files":["/allowed/a.tif"],"runtime":{"timeoutMs":300000,"fileTimeoutMs":60000}},"_meta":{"progressToken":"image-job"}}}
```

上例使用已完成 `initialize` 的 legacy MCP 会话；现代会话还需本项目要求的协议版本与客户端能力元数据。分析任务按顺序执行以避免配置端口竞争，但 `ping` 和取消通知不会排在分析队列后。取消已排队任务也有效，不会启动该任务。stdin EOF 会等待已有任务完成；SIGTERM/SIGINT 会取消任务并清理资源。

The example assumes a legacy MCP session has completed `initialize`; modern requests must additionally include this server's protocol-version and client-capability metadata. Analyses execute serially to avoid configured-port conflicts, while ping and cancellation remain responsive. A cancelled queued request never starts. EOF drains pending jobs; SIGTERM/SIGINT cancel them and clean up resources.

```json
{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":7,"reason":"User stopped the analysis"}}
```

取消通知不返回响应，已取消请求也不再发送工具结果或进度。客户端若需要保留部分结果，应优先设置运行时限；主动取消后按照协议停止返回该请求的数据。

Cancellation notifications receive no response; a cancelled request sends no further tool result or progress. Set deadlines when a returned partial result is needed: explicit cancellation suppresses that request's response according to the protocol.

Protocol references: [MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation), [MCP progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress). Process-group cleanup supports macOS, Linux and WSL, the documented runtime platforms.
