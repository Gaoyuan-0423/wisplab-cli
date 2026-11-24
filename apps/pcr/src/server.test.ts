import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createAnalyzerServer } from '../api/server';

const here = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = join(here, '../tests/fixtures');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createAnalyzerServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (typeof addr !== 'object' || !addr) throw new Error('no address');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('本机分析 API', () => {
  it('GET /api/health', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('POST /api/analyze 返回完整报告', async () => {
    const bytes = readFileSync(join(FIXTURES, 'cfx-ntc-style.csv'));
    const res = await fetch(`${baseUrl}/api/analyze?filename=cfx-ntc-style.csv`, {
      method: 'POST',
      body: new Uint8Array(bytes),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.file.name).toBe('cfx-ntc-style.csv');
    expect(body.experiment.refGenes).toContain('GAPDH');
    expect(body.experiment.controlSamples.length).toBeGreaterThan(0);
    expect(body.report.score).toBeLessThanOrEqual(100);
    expect(body.report.issues.some((i: { code: string }) => i.code === 'NTC_CONTAMINATED')).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]).toHaveProperty('pDunnett');
    expect(body.meta.privacy).toContain('locally');
  });

  it('坏文件返回 400 与错误信息', async () => {
    const res = await fetch(`${baseUrl}/api/analyze?filename=bad.xlsx`, {
      method: 'POST',
      body: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x99, 0x98, 0x97, 0x96, 1, 2, 3, 4, 5, 6, 7, 8]),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
  });

  it('未知路径返回 404', async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });
});
