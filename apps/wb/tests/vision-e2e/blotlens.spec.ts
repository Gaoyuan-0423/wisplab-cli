import { expect, test } from "@playwright/test";

test("the embedded local BlotLens uses its own same-origin settings endpoint", async ({ page }) => {
  const configRequest = page.waitForResponse(response =>
    response.url().endsWith("/blotlens/api/config") && response.request().method() === "GET");
  await page.goto("/?lang=zh#blotlens");
  const config = await configRequest;
  expect(config.ok()).toBe(true);
  expect(await config.json()).toMatchObject({ baseUrl: "https://api.openai.com/v1", keyConfigured: false });
  await expect(page.getByRole("button", { name: "导入核对截图" })).toBeEnabled();
  const child = page.frameLocator(".blotlens-workflow iframe");
  await child.getByRole("button", { name: "API 设置", exact: true }).click();
  await child.getByLabel("模型名", { exact: true }).fill("local-review-fixture");
  const saved = page.waitForResponse(response =>
    response.url().endsWith("/blotlens/api/config") && response.request().method() === "POST");
  await child.getByRole("button", { name: "保存设置", exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(child.getByRole("dialog")).toHaveCount(0);
  expect(await (await page.request.get("/blotlens/api/config")).json()).toMatchObject({
    model: "local-review-fixture", keyConfigured: false,
  });
});
