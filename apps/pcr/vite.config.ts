/// <reference types="vitest/config" />
import { execFileSync } from "node:child_process";
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [{ name: "wisplab-build-identity", transformIndexHtml() {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim();
    return [{ tag: "meta", attrs: { name: "wisplab-build", content: "pcr:" + sha + (dirty ? ":local-changes" : "") }, injectTo: "head" as const }];
  }}, react()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
})
