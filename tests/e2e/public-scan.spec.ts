import { captureUiAudit } from "./uiAudit";
import { expect, test } from "./fixtures";

test("public cage card deep links stay on the React entry", async ({ page }, testInfo) => {
  await page.goto("/c/UNKNOWN-E2E");
  await expect(page.getByRole("heading", { name: "未找到笼卡信息", exact: true })).toBeVisible();
  await expect(page.getByText("UNKNOWN-E2E", { exact: true })).toBeVisible();
  await captureUiAudit(page, testInfo, "public-scan-unavailable");
});

test("missing status is not presented as pending receipt and zero animals remain visible", async ({ page }) => {
  await page.route("**/api/public/cage-card/ZERO", (route) =>
    route.fulfill({
      json: { item: { qrId: "ZERO", batchNo: "零数量扫码回归", animalCount: 0, statusLabel: "" } },
    }),
  );
  await page.goto("/c/ZERO");
  await expect(page.getByRole("heading", { name: "零数量扫码回归", exact: true })).toBeVisible();
  await expect(page.getByText("状态未知", { exact: true })).toBeVisible();
  await expect(page.getByText("待接收", { exact: true })).toHaveCount(0);
  await expect(page.getByText("0 只", { exact: true })).toBeVisible();
});
