import { resolve } from "node:path";

import { expect, openNavigationEntry, test } from "./fixtures";

// Headless Chromium hides native scrollbars by default; exercise the same
// scrollbar painting and mouse hit area as the actual desktop browser.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

for (const colorScheme of ["light", "dark"] as const) {
  test(`common table scrollbars stay draggable and visually thin in ${colorScheme} mode`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    const login = await page.request.post("/api/auth/login", {
      data: { username: "admin", password: "admin123" },
    });
    expect(login.ok()).toBeTruthy();
    await page.goto("/app");
    const evidence = [];
    for (const [group, entry, selector] of [
      ["笼卡管理", "待接收批次", ".intake-batch-table"],
      ["饲养费管理", "已保存数量统计表", ".quantity-saved-table"],
      ["检疫管理", "PCR检测", '[data-feature="quarantine"] .ant-table-wrapper'],
    ]) {
      if (entry === "PCR检测") await page.setViewportSize({ width: 760, height: 900 });
      await openNavigationEntry(page, group, entry);
      const scroller = page.locator(selector).locator(".ant-table-content");
      await expect(scroller).toBeVisible();
      await scroller.scrollIntoViewIfNeeded();
      const metrics = await scroller.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const track = getComputedStyle(element, "::-webkit-scrollbar");
        const thumb = getComputedStyle(element, "::-webkit-scrollbar-thumb");
        const size = Number.parseFloat(track.height);
        return {
          width: element.clientWidth,
          contentWidth: element.scrollWidth,
          gutter: rect.height - element.clientHeight,
          visibleThumb: size - Number.parseFloat(thumb.borderTopWidth) - Number.parseFloat(thumb.borderBottomWidth),
          x: rect.x,
          y: rect.bottom - size / 2,
        };
      });
      expect(metrics.contentWidth).toBeGreaterThan(metrics.width);
      expect(metrics.gutter).toBeGreaterThanOrEqual(9);
      expect(metrics.visibleThumb).toBe(6);
      await expect(page.locator('[data-ui="workspace"]')).toHaveCSS("scrollbar-width", "thin");
      const thumbWidth = (metrics.width * metrics.width) / metrics.contentWidth;
      const x = metrics.x + thumbWidth / 2;
      await page.mouse.move(x, metrics.y);
      await page.mouse.down();
      await page.mouse.move(x + Math.min(90, (metrics.width - thumbWidth) / 2), metrics.y, { steps: 6 });
      await page.mouse.up();
      await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      expect(
        await scroller.evaluate((element) => getComputedStyle(element, "::-webkit-scrollbar-thumb").backgroundClip),
      ).toBe("padding-box");
      await page.mouse.move(0, 0);
      evidence.push({ entry, colorScheme, ...metrics });
      const screenshot = await page.screenshot({ animations: "disabled" });
      await info.attach(`${entry}-${colorScheme}`, { body: screenshot, contentType: "image/png" });
      if (process.env.CAGELEDGER_E2E_OUTPUT_DIR) {
        await page.screenshot({
          path: resolve(process.env.CAGELEDGER_E2E_OUTPUT_DIR, `${entry}-${colorScheme}.png`),
          animations: "disabled",
        });
      }
    }
    await info.attach("scrollbar-evidence", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
  });
}
