import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("screenshot review survives WB navigation and round-trips its separate analysis", async ({ page }) => {
  const recognition: string[] = [];
  page.on("request", request => {
    if (request.url().endsWith("/api/recognize")) recognition.push(request.url());
  });
  await page.goto("/?lang=zh");
  const entry = page.locator('.home a[href$="#blotlens"]');
  await entry.click();
  const child = page.frameLocator(".blotlens-workflow iframe");
  await expect(page.getByRole("button", { name: "导入核对截图" })).toBeEnabled();
  await child.getByRole("button", { name: "先试试合成示例" }).click();
  const rows = child.locator("#measurements tbody tr");
  await expect(rows).toHaveCount(15);
  const measurements = await rows.allTextContents();
  await page.getByRole("link", { name: "返回 WB 首页" }).click();
  await expect(entry).toBeVisible();
  await page.locator('.home a[href*="mode=single"]').click();
  await page.getByRole("link", { name: "返回工作台", exact: true }).click();
  await page.locator('.home a[href$="#demo"]').click();
  await page.getByRole("link", { name: "截图趋势核对", exact: true }).click();
  expect(await rows.allTextContents()).toEqual(measurements);

  await child.getByRole("button", { name: "导出", exact: true }).click();
  const download = page.waitForEvent("download");
  await child.getByRole("button", { name: "可复算分析文件 JSON", exact: true }).click();
  const saved = await readFile((await (await download).path())!);
  const review = JSON.parse(saved.toString());
  expect(review.format).toBe("wb-review");
  await page.getByLabel("导入工作台核对截图").setInputFiles({
    name: "original-example.png", mimeType: "image/png",
    buffer: Buffer.from(review.source.dataUrl.split(",")[1], "base64"),
  });
  await expect(child.getByRole("heading", { name: "original-example.png" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "截图已载入" })).toBeVisible();
  await child.locator('input[accept="application/json,.json"]').setInputFiles({
    name: "example-review.json", mimeType: "application/json", buffer: saved,
  });
  await expect(rows).toHaveCount(15);
  expect(await rows.allTextContents()).toEqual(measurements);
  expect(recognition).toEqual([]);
});

test("the WB language and mobile layout reach the embedded page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=en#blotlens");
  const child = page.frameLocator(".blotlens-workflow iframe");
  await expect(page.getByRole("button", { name: "Import screenshot" })).toBeEnabled();
  await expect(child.locator("html")).toHaveAttribute("lang", "en");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
