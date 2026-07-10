import { expect, test } from "./fixtures";

test("restores the active workspace after a browser refresh", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();

  await page.evaluate(() =>
    localStorage.setItem("cageledger.ui.v2", JSON.stringify({ activeView: "billing-quantity-entry" })),
  );

  await page.reload();
  await expect(page.getByRole("heading", { name: "数量统计表（录入）", exact: true })).toBeVisible({ timeout: 15_000 });
});
