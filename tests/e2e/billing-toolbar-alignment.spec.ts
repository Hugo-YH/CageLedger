import type { Locator } from "@playwright/test";
import { expect, openNavigationEntry, openQuantityEntry, test } from "./fixtures";

async function headingGeometry(toolbar: Locator) {
  const heading = toolbar.getByRole("heading");
  await expect(heading).toHaveCSS("font-size", "24px");
  await expect(heading).toHaveCSS("font-weight", "600");
  return heading.evaluate((element) => {
    const bar = element.closest('[data-ui="workspace-toolbar"]')!;
    const title = element.getBoundingClientRect();
    const bounds = bar.getBoundingClientRect();
    return {
      titleX: title.x,
      titleY: title.y,
      barX: bounds.x,
      barY: bounds.y,
      barHeight: bounds.height,
      titleHeight: title.height,
      barRight: bounds.right,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      nestedCard: Boolean(bar.closest(".ant-card")),
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1180, height: 900 },
  { width: 760, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`billing page headings share toolbar alignment at ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/app");
    await page.getByLabel("用户名", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("admin123");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await openQuantityEntry(page);
    const baseline = await headingGeometry(page.getByRole("group", { name: "数量统计表录入操作", exact: true }));
    for (const [title, group, help] of [
      ["结算管理", "结算批量操作", "结算合表说明"],
      ["单据跟踪", "结算流程批量操作", "单据跟踪说明"],
      ["汇总导出", "月度结算汇总操作", "汇总导出说明"],
    ]) {
      await openNavigationEntry(page, "饲养费管理", title);
      const toolbar = page.getByRole("group", { name: group, exact: true });
      const geometry = await headingGeometry(toolbar);
      expect(geometry.barX).toBeCloseTo(baseline.barX, 0);
      expect(geometry.barY).toBeCloseTo(baseline.barY, 0);
      expect(geometry.titleX).toBeCloseTo(baseline.titleX, 0);
      if (viewport.width >= 768) {
        // Context controls can wrap below the title on narrow desktop screens.
        // Compare title positions only when both bars have the same row layout.
        if (Math.abs(geometry.barHeight - baseline.barHeight) < 1) {
          expect(geometry.titleY).toBeCloseTo(baseline.titleY, 0);
        }
        if (Math.abs(geometry.barHeight - 64) < 1) {
          expect(geometry.titleY + geometry.titleHeight / 2).toBeCloseTo(geometry.barY + 32, 0);
        }
        expect(geometry.titleY).toBeGreaterThanOrEqual(geometry.barY + 12);
        expect(geometry.titleY + geometry.titleHeight).toBeLessThanOrEqual(geometry.barY + geometry.barHeight - 12);
      }
      expect(geometry.lineHeight).toBeCloseTo(32, 1);
      expect(geometry.barRight).toBeLessThanOrEqual(viewport.width);
      expect(geometry.nestedCard).toBe(false);
      expect(geometry.pageOverflow).toBe(false);
      if (title === "单据跟踪") {
        const clear = toolbar.getByRole("button", { name: "清空选择", exact: true });
        const placement = await clear.evaluate((element) => {
          const bar = element.closest('[data-ui="workspace-toolbar"]')!;
          return {
            inActions: Boolean(element.closest(".app-command-bar-actions")),
            right: element.getBoundingClientRect().right,
            expectedRight:
              bar.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(bar).paddingRight) - 1,
          };
        });
        expect(placement.inActions).toBe(true);
        expect(placement.right).toBeCloseTo(placement.expectedRight, 0);
        await expect(clear).toBeDisabled();
      }
      const hint = toolbar.getByRole("button", { name: help, exact: true });
      await hint.click();
      await expect(hint).toHaveAttribute("aria-expanded", "true");
      await hint.press("Escape");
      await expect(hint).toHaveAttribute("aria-expanded", "false");
      await testInfo.attach(`${title}-layout`, { body: JSON.stringify(geometry), contentType: "application/json" });
      await page.screenshot({ path: testInfo.outputPath(`${title}.png`), animations: "disabled" });
    }
  });
}
