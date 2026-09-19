import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, openIntakeEntry, openQuantityEntry, openSettingsView, openWorkflowCenter, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function expectNoSeriousViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  const violations = result.violations.filter((item) => item.impact === "critical" || item.impact === "serious");
  expect(violations, violations.map((item) => `${item.id}: ${item.help}`).join("\n")).toEqual([]);
}

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
}

test("login and dashboard have no serious accessibility violations", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
  await expectNoSeriousViolations(page);
  await login(page);
  await expectNoSeriousViolations(page);
});

test("core workspaces and dialogs retain accessible semantics", async ({ page }) => {
  await login(page);

  await openIntakeEntry(page);
  await expect(page.getByRole("heading", { name: "接收笼卡", exact: true, level: 2 })).toBeVisible();
  await expectNoSeriousViolations(page);

  await openQuantityEntry(page);
  await expect(page.getByRole("heading", { name: "录入数量统计表", exact: true, level: 2 })).toBeVisible();
  await expectNoSeriousViolations(page);

  await openWorkflowCenter(page);
  await expect(page.getByRole("heading", { name: "单据跟踪", exact: true, level: 2 })).toBeVisible();
  await expectNoSeriousViolations(page);

  await openSettingsView(page, "房间管理");
  const openRoomEditor = page.getByRole("button", { name: "新增饲养间", exact: true });
  // Keyboard entry has a focused return target in every engine; WebKit mouse
  // clicks intentionally do not focus native buttons.
  await openRoomEditor.focus();
  await openRoomEditor.press("Enter");
  const dialog = page.getByRole("dialog", { name: "新增饲养间" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭", exact: true })).toBeFocused();
  await expectNoSeriousViolations(page);
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(openRoomEditor).toBeFocused();

  await openSettingsView(page, "关于系统");
  await expect(page.getByRole("heading", { name: "系统状态", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新状态", exact: true })).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("populated workflow tags and hidden measuring rows remain accessible in both themes", async ({ page }) => {
  await login(page);
  await page.route("**/api/billing-workflows?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "accessible-archived",
            month: "2026-09",
            pi: "可读性检查",
            iacucs: ["E2E-AA"],
            manager: "系统管理员",
            totalAmount: 20,
            workflowStatus: "statement_archived",
            signedStatementReturned: true,
            reimbursementFormReturned: true,
          },
        ],
        page: { total: 1, offset: 0, limit: 10 },
      },
    }),
  );
  await openWorkflowCenter(page);
  await expect(page.getByText("结算单 已交回", { exact: true })).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    await expectNoSeriousViolations(page);
  }
});

test("public surfaces remain readable on phones in light and dark themes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/public/cage-card/THEME", (route) =>
    route.fulfill({
      json: { item: { qrId: "THEME", batchNo: "笼卡主题检查", statusLabel: "已入驻", pi: "张三", animalCount: 5 } },
    }),
  );
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const [path, name] of [
      ["/", "portal"],
      ["/app", "login"],
      ["/c/THEME", "public-scan"],
    ]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      if (name === "public-scan") await expect(page.getByText("5 只", { exact: true })).toBeVisible();
      await expectNoSeriousViolations(page);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${colorScheme}.png`), animations: "disabled" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    }
  }
});
