import { captureUiAudit } from "./uiAudit";
import { expect, test } from "./fixtures";

test("public cage card deep links stay on the React entry", async ({ page }, testInfo) => {
  await page.goto("/c/UNKNOWN-E2E");
  await expect(page.getByRole("heading", { name: "未找到笼卡信息", exact: true })).toBeVisible();
  await expect(page.getByText("UNKNOWN-E2E", { exact: true })).toBeVisible();
  await captureUiAudit(page, testInfo, "public-scan-unavailable");
});

test("public scan distinguishes a service failure and retries the same card on request", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  let requests = 0;
  await page.route("**/api/public/cage-card/RECOVER-E2E", async (route) => {
    requests += 1;
    await route.fulfill(
      requests === 1
        ? { status: 503, json: { error: "服务繁忙，请稍后重试" } }
        : { json: { item: { qrId: "RECOVER-E2E", batchNo: "重试恢复笼卡", animalCount: 0, statusLabel: "已入驻" } } },
    );
  });
  await page.goto("/c/RECOVER-E2E");
  await expect(page.getByRole("heading", { name: "笼卡信息加载失败", exact: true })).toBeVisible();
  await expect(page.getByText("服务繁忙，请稍后重试", { exact: true })).toBeVisible();
  await expect(page.getByText(/请检查网络连接后重试/)).toBeVisible();
  expect(requests).toBe(1);
  await page.screenshot({
    path: testInfo.outputPath("public-scan-service-error-1440-full.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("heading", { name: "重试恢复笼卡", exact: true })).toBeVisible();
  await expect(page.getByText("0 只", { exact: true })).toBeVisible();
  await expect(page.getByText("已入驻", { exact: true })).toBeVisible();
  expect(requests).toBe(2);
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
