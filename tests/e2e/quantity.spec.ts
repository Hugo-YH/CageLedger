import { ensureTestInfrastructure, expect, test } from "./fixtures";

test("save and delete a quantity sheet in the ephemeral database", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await page.getByRole("button", { name: "饲养费管理", exact: true }).click();
  await page.getByRole("combobox", { name: "房间号", exact: true }).selectOption({ label: "8014" });
  await page.getByRole("combobox", { name: "IACUC 编号", exact: true }).fill("E2E-IACUC-001");
  await page.locator("form").getByLabel("项目负责人", { exact: true }).fill("E2E负责人");
  await page.getByLabel("第 1 行结余笼数", { exact: true }).fill("2");
  await page.getByRole("button", { name: "保存统计表", exact: true }).click();
  await expect(page.getByRole("heading", { name: "确认保存数量统计表", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("统计表已保存");
  const savedRow = page.getByRole("row", { name: /E2E-IACUC-001/ });
  await expect(savedRow).toBeVisible();
  await savedRow.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(savedRow).toHaveCount(0);
});
