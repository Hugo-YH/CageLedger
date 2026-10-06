import { expect, openWorkflowCenter, test } from "./fixtures";

for (const width of [1180, 1440]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`desktop evidence ${width} ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.route("**/api/billing-workflows?*", (route) =>
        route.fulfill({
          json: {
            items: Array.from({ length: 10 }, (_, i) => ({
              id: `evidence-${i}`,
              pi: `测试项目负责人 ${i + 1}`,
              month: "2026-09",
              iacucs: ["TEST-2026-001", "TEST-2026-002", "TEST-2026-003"],
              manager: "测试登记员",
              totalAmount: 1234.56 + i * 100,
              workflowStatus: i % 3 === 0 ? "statement_locked" : "statement_sent",
              signedStatementReturned: true,
              reimbursementRequired: true,
            })),
            page: { total: 30, limit: 10, offset: 0 },
          },
        }),
      );
      await page.goto("/app");
      await page.getByLabel("用户名", { exact: true }).fill("admin");
      await page.getByLabel("密码", { exact: true }).fill("admin123");
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await openWorkflowCenter(page);
      await expect(page.getByRole("row").filter({ hasText: "测试项目负责人 1" }).first()).toBeVisible();
      await page.screenshot({
        path: `/tmp/cageledger-ux-evidence/${process.env.CAGELEDGER_EVIDENCE_PHASE || "before"}-${width}-${colorScheme}.png`,
        fullPage: true,
        animations: "disabled",
      });
      if (process.env.CAGELEDGER_EVIDENCE_PHASE === "after") {
        await page.getByText("紧凑", { exact: true }).click();
        await expect(page.locator(".app-data-table .ant-table")).toHaveClass(/ant-table-small/);
        await page.screenshot({
          path: `/tmp/cageledger-ux-evidence/compact-${width}-${colorScheme}.png`,
          fullPage: true,
          animations: "disabled",
        });
      }
    });
  }
}
