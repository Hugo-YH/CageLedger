import { writeFile } from "node:fs/promises";

import { ensureTestInfrastructure, expect, openQuantityEntry, test } from "./fixtures";

test("quantity keyboard navigation preserves row order without measuring every field", async ({ page }, testInfo) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await openQuantityEntry(page);
  const firstDate = page.getByLabel("第 1 行日期", { exact: true });
  await expect(firstDate).toBeVisible();
  const measurements = [];
  for (const details of [false, true]) {
    await page.getByRole("switch", { name: "动物数量", exact: true }).setChecked(details);
    // Keep the keyboard microbenchmark independent of hover-tooltip alignment.
    await page.mouse.move(0, 0);
    const result = await page.evaluate(() => {
      const first = document.querySelector<HTMLInputElement>('[data-quantity-row="0"][data-quantity-field="date"]')!;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Bound with .call(this) and restored in finally below.
      const original = HTMLElement.prototype.getClientRects;
      const samples: Array<{ milliseconds: number; layoutReads: number }> = [];
      for (let iteration = 0; iteration < 25; iteration += 1) {
        first.focus();
        let layoutReads = 0;
        HTMLElement.prototype.getClientRects = function () {
          if (this.matches('[data-quantity-focusable="true"]')) layoutReads += 1;
          return original.call(this);
        };
        const started = performance.now();
        try {
          first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
          samples.push({ milliseconds: performance.now() - started, layoutReads });
        } finally {
          HTMLElement.prototype.getClientRects = original;
        }
      }
      return { samples, focusedLabel: document.activeElement?.getAttribute("aria-label") };
    });
    expect(result.focusedLabel).toBe(details ? "第 1 行增加" : "第 1 行结余笼数");
    if (process.env.CAGELEDGER_CAPTURE_BASELINE !== "1") {
      expect(Math.max(...result.samples.map((sample) => sample.layoutReads))).toBeLessThanOrEqual(8);
    }
    measurements.push({ animalDetails: details, ...result });
    await firstDate.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(firstDate).toBeFocused();
  }
  await page.getByRole("switch", { name: "动物数量", exact: true }).setChecked(false);
  await page.getByLabel("第 1 行结余笼数", { exact: true }).fill("12");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("第 2 行日期", { exact: true })).toBeFocused();
  await expect(page.getByLabel("第 1 行结余笼数", { exact: true })).toHaveValue("12");
  const last = page.getByLabel("第 31 行结余笼数", { exact: true });
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(firstDate).not.toBeFocused();
  await writeFile(testInfo.outputPath("quantity-navigation.json"), JSON.stringify(measurements, null, 2));
});

test("quantity keyboard focus fully reveals controls in a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await openQuantityEntry(page);
  for (const details of [false, true]) {
    await page.getByRole("switch", { name: "动物数量", exact: true }).setChecked(details);
    await page.mouse.move(0, 0);
    await page.getByLabel("第 16 行日期", { exact: true }).focus();
    for (let index = 0; index < (details ? 6 : 1); index += 1) await page.keyboard.press("Tab");
    const right = page.getByLabel("第 16 行结余笼数", { exact: true });
    await expect(right).toBeFocused();
    await right.fill("1234");
    for (const target of [right, page.getByLabel("第 15 行结余笼数", { exact: true })]) {
      if (target !== right) {
        for (let index = 0; index < (details ? 7 : 2); index += 1) await page.keyboard.press("Shift+Tab");
      }
      await expect(target).toBeFocused();
      const visibility = await target.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        let left = Math.max(0, rect.left);
        let right = Math.min(innerWidth, rect.right);
        let top = Math.max(0, rect.top);
        let bottom = Math.min(innerHeight, rect.bottom);
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          const clip = parent.getBoundingClientRect();
          if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
            left = Math.max(left, clip.left + parent.clientLeft);
            right = Math.min(right, clip.left + parent.clientLeft + parent.clientWidth);
          }
          if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
            top = Math.max(top, clip.top + parent.clientTop);
            bottom = Math.min(bottom, clip.top + parent.clientTop + parent.clientHeight);
          }
        }
        return { width: rect.width, height: rect.height, visibleWidth: right - left, visibleHeight: bottom - top };
      });
      expect(visibility.visibleWidth).toBeGreaterThanOrEqual(visibility.width - 1);
      expect(visibility.visibleHeight).toBeGreaterThanOrEqual(visibility.height - 1);
    }
    await expect(right).toHaveValue("1234");
  }
});
