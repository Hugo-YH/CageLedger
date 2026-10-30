import { expect, openSettingsView, test } from "./fixtures";
import type { Page } from "@playwright/test";

async function login(page: Page) {
  const health = await (await page.request.get("/api/health")).json();
  expect(health.database).toMatch(/cageledger-e2e-[^/]+\/cageledger\.sqlite$/);
  expect((await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } })).ok()).toBe(
    true,
  );
  await page.goto("/app");
}

test("home and refresh confirm dirty drafts without clearing preferences on cancellation", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  await openSettingsView(page, "系统功能");
  await page.getByRole("switch", { name: "检疫管理", exact: true }).click();
  const preferences = await page.evaluate(() => localStorage.getItem("cageledger.ui.v2"));
  const dialog = page.getByRole("dialog", { name: "离开并放弃未保存的修改？" });
  for (const action of [
    () => page.getByRole("menuitem", { name: /主页$/ }).click(),
    () => page.getByRole("button", { name: "刷新页面", exact: true }).click(),
  ]) {
    await action();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "继续编辑", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "检疫管理", exact: true })).toHaveAttribute("aria-checked", "false");
    expect(await page.evaluate(() => localStorage.getItem("cageledger.ui.v2"))).toBe(preferences);
    await expect(page).toHaveURL(/\/app/);
  }
  await page.screenshot({ path: info.outputPath("cancel-preserves-draft-and-context.png"), animations: "disabled" });
  let nativeDialogs = 0;
  page.on("dialog", async (native) => {
    nativeDialogs += 1;
    await native.dismiss();
  });
  await page.getByRole("menuitem", { name: /主页$/ }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "放弃修改并离开", exact: true }).click();
  await expect(page).toHaveURL(/:\d+\/$/);
  await expect(page.locator('[data-feature="project-home"]')).toBeVisible();
  expect(nativeDialogs).toBe(0);
});

test("data imports block home and refresh while pending and keep errors available for retry", async ({ page }) => {
  await login(page);
  await openSettingsView(page, "数据管理");
  const preferences = await page.evaluate(() => localStorage.getItem("cageledger.ui.v2"));
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/reimbursement-records/import-monthly", async (route) => {
    await held;
    await route.fulfill({ status: 400, json: { error: "合成工作表 C2 金额不合法，请修正后重试" } });
  });
  const upload = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/reimbursement-records/import-monthly",
  );
  const reply = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/reimbursement-records/import-monthly",
  );
  try {
    await page
      .locator(".data-import-dragger")
      .filter({ hasText: "导入月汇总 Excel" })
      .locator('input[type="file"]')
      .setInputFiles({
        name: "synthetic.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from("synthetic intercepted workbook"),
      });
    await upload;
    for (const action of [
      () => page.getByRole("menuitem", { name: /主页$/ }).click(),
      () => page.getByRole("button", { name: "刷新页面", exact: true }).click(),
    ]) {
      await action();
      await expect(page.getByText("正在保存或上传，请完成后再离开", { exact: true }).last()).toBeVisible();
      await expect(page.getByRole("heading", { name: "数据管理", exact: true })).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem("cageledger.ui.v2"))).toBe(preferences);
    }
  } finally {
    release();
  }
  expect((await reply).status()).toBe(400);
  await expect(page.locator('[data-feature="administration"]').getByRole("alert")).toContainText(
    "合成工作表 C2 金额不合法，请修正后重试",
  );
  await expect(page.getByText("正在处理文件...", { exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: /主页$/ }).click();
  await expect(page.locator('[data-feature="project-home"]')).toBeVisible();
});
