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

export function contrastFromLayers(layers: Array<{ color: string; background: string; opacity: string }>) {
  const numbers = (color: string) => (color.match(/[0-9.]+/g) || []).map(Number);
  const foreground = numbers(layers[0].color);
  const background = numbers(layers.find((layer) => layer.background !== "rgba(0, 0, 0, 0)")!.background);
  const alpha = (foreground[3] ?? 1) * layers.reduce((value, layer) => value * Number(layer.opacity), 1);
  const effective = foreground.slice(0, 3).map((value, index) => value * alpha + background[index] * (1 - alpha));
  const luminance = (rgb: number[]) =>
    rgb.slice(0, 3).reduce((total, value, index) => {
      const channel = value / 255;
      return (
        total +
        (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]
      );
    }, 0);
  const values = [luminance(effective), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}
