import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect } from "./fixtures";

/** Save responsive evidence at the populated/error state exercised by a business test. */
export async function captureUiAudit(page: Page, testInfo: TestInfo, name: string, target?: Locator) {
  const original = page.viewportSize();
  const viewports = [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
  ];
  for (const [width, height] of viewports.filter(
    ([width]) => !testInfo.project.metadata.desktopOnly || width >= 1180,
  )) {
    await page.setViewportSize({ width, height });
    if (target) {
      await expect(target).toBeVisible();
      await expect(target).not.toHaveClass(/ant-zoom-(?:appear|enter)/);
      // Capture the settled drawer/modal after its entry motion and responsive resize.
      await expect
        .poll(() =>
          target.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return rect.x >= 0 && rect.right <= innerWidth + 1;
          }),
        )
        .toBe(true);
    }
    // Resize and modal motion may settle on separate WebKit rendering frames.
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const geometry = await (target || page.locator("main").first()).evaluate((root) => {
      const rect = root.getBoundingClientRect();
      const controls = [
        ...root.querySelectorAll<HTMLElement>(".ant-btn, .ant-picker, .ant-input, .ant-select, .ant-switch"),
      ]
        .filter((el) => el.getClientRects().length)
        .map((el) => ({
          label: el.getAttribute("aria-label") || el.textContent,
          rect: el.getBoundingClientRect().toJSON(),
          height: getComputedStyle(el).height,
          radius: getComputedStyle(el).borderRadius,
          font: getComputedStyle(el).fontSize,
        }));
      return {
        rect: rect.toJSON(),
        viewport: innerWidth,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        controls,
      };
    });
    expect(geometry.pageOverflow).toBe(false);
    if (target) {
      expect(geometry.rect.x).toBeGreaterThanOrEqual(0);
      expect(geometry.rect.right).toBeLessThanOrEqual(width + 1);
    }
    await testInfo.attach(`${name}-${width}-geometry`, {
      body: JSON.stringify(geometry),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), animations: "disabled" });
  }
  if (original) await page.setViewportSize(original);
}
