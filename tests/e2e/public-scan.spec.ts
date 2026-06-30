import { expect, test } from "./fixtures";

test("public cage card deep links stay on the React entry", async ({ page }) => {
  await page.goto("/c/UNKNOWN-E2E");
  await expect(page.getByRole("heading", { name: "未找到笼卡信息", exact: true })).toBeVisible();
  await expect(page.getByText("UNKNOWN-E2E", { exact: true })).toBeVisible();
});
