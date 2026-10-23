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
