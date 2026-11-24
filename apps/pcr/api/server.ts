// 本机分析 API：POST /api/analyze —— 上传仪器导出文件，返回一键分析的完整 JSON 报告。
// 仅监听 127.0.0.1：数据只在本机回环接口流动，不落盘、不上传。
//
//   npm run api
//   curl -s -X POST --data-binary @result.csv "http://127.0.0.1:4318/api/analyze?filename=result.csv" | jq .

import { createServer, type Server } from 'node:http';
import { analyzeFileAuto } from '../src/core/auto';

export const API_PORT = 4318;
const MAX_BODY = 64 * 1024 * 1024; // 64 MiB

export function createAnalyzerServer(): Server {
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/api/health') {
      res.end(JSON.stringify({ ok: true, service: 'pcr-workbench-api', privacy: 'localhost only, nothing persisted' }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          aborted = true;
          res.statusCode = 413;
          res.end(JSON.stringify({ ok: false, error: '文件超过 64 MiB 上限' }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', async () => {
        if (aborted) return;
        try {
          const filename = url.searchParams.get('filename') || 'upload.csv';
          const file = new File([Buffer.concat(chunks)], filename);
          const result = await analyzeFileAuto(file);
          res.end(
            JSON.stringify({
              ok: true,
              file: { name: filename, sheet: result.sheetName, headerRow: result.headerRow + 1 },
              mapping: result.mapping,
              experiment: {
                controlSamples: result.guess.controlSamples,
                refGenes: result.guess.refGenes,
                basis: result.guess.basis,
                inferred: true,
              },
              report: result.report,
              ntc: result.output.ntcReport,
              warnings: result.output.warnings,
              results: result.output.results.map((r) => ({
                target: r.target,
                sample: r.sample,
                group: r.group,
                isControl: r.isControl,
                n: r.n,
                wells: r.wells,
                meanCq: r.meanCq,
                sdCq: r.sdCq,
                refCq: r.refCq,
                deltaCt: r.deltaCt,
                ddCt: r.ddCt,
                foldChange: r.foldChange,
                fcSd: r.fcSd,
                p: r.pValue,
                pDunnett: r.pAdjusted,
                significance: r.significance,
                statMethod: r.statMethod,
              })),
              melt: result.melt,
              qcFlaggedRows: Object.entries(result.flags).map(([id, reasons]) => ({ id: Number(id), reasons })),
              meta: {
                generator: 'PCR Workbench · PCR 工作台',
                method: 'Livak 2^-ΔΔCt; Welch t (2组) / one-way ANOVA + Dunnett (多组); 个体 ΔCt 层面统计',
                privacy: 'processed locally, nothing persisted',
              },
            }),
          );
        } catch (err) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
        }
      });
      req.on('error', () => {});
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: '未知的接口。可用：GET /api/health、POST /api/analyze?filename=xxx' }));
  });
}

export function startAnalyzerServer(port: number = API_PORT): Server {
  const server = createAnalyzerServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`PCR Workbench 分析 API 已启动：http://127.0.0.1:${port}/api/analyze`);
    console.log('示例：curl -s -X POST --data-binary @result.csv "http://127.0.0.1:4318/api/analyze?filename=result.csv"');
    console.log('仅监听 127.0.0.1，数据不离开本机。Ctrl+C 退出。');
  });
  return server;
}

// 直接执行时启动服务（被测试导入时不启动）
if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  startAnalyzerServer();
}
