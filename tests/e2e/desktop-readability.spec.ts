import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
});

test("short desktop windows retain account information and keep both actions on one row", async ({ page }, info) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1093, height: 614 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() => page.locator(".ant-sidebar").evaluate((element) => element.getBoundingClientRect().height))
      .toBe(viewport.height);
    const account = page.locator(".ant-sidebar-account");
    await expect(account).toContainText("当前账号");
    await expect(account).toContainText("系统管理员");
    await expect(account).toContainText("管理员 · 全部饲养间");
    const refresh = account.getByRole("button", { name: "刷新页面", exact: true });
    const signOut = account.getByRole("button", { name: "退出登录", exact: true });
    await expect(refresh).toBeVisible();
    await expect(signOut).toBeVisible();
    const geometry = await account.evaluate((element) => {
      const actions = Array.from(element.querySelectorAll("button")).map((button) =>
        button.getBoundingClientRect().toJSON(),
      );
      return {
        actions,
        menuHeight: document.querySelector(".ant-main-menu")!.getBoundingClientRect().height,
        height: innerHeight,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(geometry.pageOverflow).toBe(false);
    for (const action of geometry.actions) {
      expect(action.top).toBeGreaterThanOrEqual(0);
      expect(action.bottom).toBeLessThanOrEqual(geometry.height);
      expect(action.height).toBe(32);
    }
    if (viewport.height <= 500) {
      expect(geometry.actions[0].top).toBeCloseTo(geometry.actions[1].top, 0);
      expect(geometry.menuHeight).toBeGreaterThan(190);
    } else {
      expect(geometry.actions[0].bottom).toBeLessThan(geometry.actions[1].top);
    }
    await page.screenshot({
      path: info.outputPath(`desktop-${viewport.width}x${viewport.height}.png`),
      animations: "disabled",
    });
  }
});

test("zero dashboard counts stay readable and neutral in both themes and motion preferences", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  const counts = page.locator(".ant-dashboard-task-count .ant-badge-count");
  await expect(counts).toHaveCount(2);
  await expect(counts).toHaveText(["0", "0"]);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    const styles = await counts.evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color };
      }),
    );
    for (const style of styles) {
      expect(style.background).not.toBe("rgb(255, 77, 79)");
      expect(style.color).not.toBe("rgb(255, 255, 255)");
    }
    const audit = await new AxeBuilder({ page })
      .include(".ant-dashboard-task-count")
      .withRules(["color-contrast"])
      .analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`dashboard-zero-${colorScheme}.png`), animations: "disabled" });
    await page.emulateMedia({ colorScheme, reducedMotion: "no-preference" });
    await expect(counts).toHaveText(["0", "0"]);
  }
});
