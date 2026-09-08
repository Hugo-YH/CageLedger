import { expect, openNavigationEntry, openQuantityEntry, test } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
}

test("inspection remains usable when browser storage is denied", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage denied", "SecurityError");
      },
    });
  });
  await login(page);
  await openNavigationEntry(page, "动物管理", "动物巡检");
  await expect(page.getByRole("button", { name: "基础评估说明" })).toBeVisible();
});

test("quantity date button works without native showPicker", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLInputElement.prototype, "showPicker", { configurable: true, value: undefined });
  });
  await login(page);
  await openQuantityEntry(page);
  await page.getByRole("button", { name: "选择第 1 行日期", exact: true }).click();
  await expect(page.locator(".ant-picker-dropdown, .ant-popover").filter({ visible: true })).toBeInViewport();
});

for (const settings of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1180, height: 900 },
  { name: "mobile", width: 760, height: 900 },
  { name: "landscape", width: 844, height: 390 },
  { name: "touch-dark", width: 390, height: 844, touch: true, dark: true },
  { name: "forced-colors", width: 1180, height: 900, contrast: true },
  { name: "high-dpi", width: 720, height: 450, scale: 2 },
]) {
  test.describe(settings.name, () => {
    test.use({ hasTouch: Boolean(settings.touch), deviceScaleFactor: settings.scale || 1 });
    test("shared overlays remain reachable with reduced motion", async ({ page }, testInfo) => {
      await page.setViewportSize({ width: settings.width, height: settings.height });
      await page.emulateMedia({
        reducedMotion: "reduce",
        colorScheme: settings.dark ? "dark" : "light",
        forcedColors: settings.contrast ? "active" : "none",
      });
      await login(page);
      await openQuantityEntry(page);
      const activate = async (locator: Locator) => (settings.touch ? locator.tap() : locator.click());
      await activate(page.getByRole("textbox", { name: /月份/ }));
      const monthPanel = page.locator(".ant-picker-dropdown").filter({ visible: true });
      await expect(monthPanel).toBeInViewport();
      await monthPanel.locator(".ant-picker-cell-in-view").first().click();
      await expect(monthPanel).toBeHidden();

      const dateButton = page.getByRole("button", { name: "选择第 1 行日期", exact: true });
      await activate(dateButton);
      const calendar = page.locator(".quantity-date-calendar");
      await expect(calendar).toBeInViewport();
      await expect
        .poll(async () =>
          calendar.evaluate((element) => {
            const rect = element.closest(".ant-popover")!.getBoundingClientRect();
            return (
              rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight
            );
          }),
        )
        .toBe(true);
      const day = calendar.locator("td[title]:not(.ant-picker-cell-disabled)").filter({ hasText: /^15$/ });
      const selectedDate = await day.getAttribute("title");
      await day.click();
      await expect(page.getByRole("textbox", { name: "第 1 行日期", exact: true })).toHaveValue(selectedDate!);
      await expect(calendar).toBeHidden();
      await dateButton.focus();
      await page.keyboard.press("Enter");
      await expect(calendar).toBeInViewport();
      await testInfo.attach("calendar-geometry", {
        body: JSON.stringify(
          await calendar.evaluate((element) => {
            const panel = element.closest(".ant-popover")!;
            const style = getComputedStyle(panel);
            return {
              rect: panel.getBoundingClientRect().toJSON(),
              display: style.display,
              position: style.position,
              zIndex: style.zIndex,
              overflow: element.scrollWidth > element.clientWidth,
            };
          }),
        ),
        contentType: "application/json",
      });
      await testInfo.attach("calendar-open", { body: await page.screenshot(), contentType: "image/png" });
      await expect(calendar.getByRole("button", { name: selectedDate!, exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(calendar).toBeHidden();
      await dateButton.press("Enter");
      await page.keyboard.press("Escape");
      await expect(calendar).toBeHidden();
      await expect(dateButton).toBeFocused();

      const select = page.getByRole("combobox", { name: "房间号", exact: true });
      await activate(select);
      await expect(page.locator(".ant-select-dropdown").filter({ visible: true })).toBeInViewport();
      await page.keyboard.press("Escape");

      await openNavigationEntry(page, "动物管理", "动物巡检");
      await activate(page.getByRole("button", { name: "巡检对象快照说明", exact: true }));
      await expect(page.locator(".ant-popover").filter({ visible: true })).toBeInViewport();
      await page.keyboard.press("Escape");
      await openNavigationEntry(page, "系统设置", "房间管理");
      await activate(page.getByRole("button", { name: "新增饲养间", exact: true }));
      const dialog = page.getByRole("dialog", { name: "新增饲养间" });
      await expect(dialog).toBeInViewport();
      await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    });
  });
}
