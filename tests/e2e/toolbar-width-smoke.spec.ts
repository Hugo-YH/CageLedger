import { expect, openQuantityEntry, test } from "./fixtures";

test("shared toolbar keeps its controls within five viewport widths", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await openQuantityEntry(page);
  const toolbar = page.locator(".quantity-entry-toolbar");
  await expect(toolbar).toBeVisible();
  for (const width of [1440, 1200, 992, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(toolbar.getByRole("button", { name: "保存统计表", exact: true })).toHaveCSS(
      "height",
      width < 768 ? "44px" : "32px",
    );
    const metrics = await toolbar.evaluate((element) => {
      const bar = element.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        left: bar.left,
        right: bar.right,
        controls: [...element.querySelectorAll(".app-command-bar-actions button")]
          .filter((button) => button.getClientRects().length)
          .map((button) => {
            const rect = button.getBoundingClientRect();
            return { left: rect.left, right: rect.right, height: rect.height };
          }),
      };
    });
    expect(metrics.overflow, `overflow at ${width}`).toBe(false);
    expect(metrics.left).toBeGreaterThanOrEqual(-1);
    expect(metrics.right).toBeLessThanOrEqual(width + 1);
    expect(metrics.controls.length).toBeGreaterThan(0);
    for (const control of metrics.controls) {
      expect(control.left).toBeGreaterThanOrEqual(-1);
      expect(control.right).toBeLessThanOrEqual(width + 1);
      expect(control.height).toBeGreaterThanOrEqual(width < 768 ? 44 : 32);
    }
  }
  const save = toolbar.locator('.app-command-bar-actions button[type="submit"]');
  await save.evaluate((button) => {
    const label = button.querySelector("span:last-child");
    if (label) label.textContent = "这是一段用于验证窄屏工具栏长操作名称自动换行的测试文字";
  });
  const longButton = await save.boundingBox();
  const toolbarBox = await toolbar.boundingBox();
  if (!longButton || !toolbarBox) throw new Error("工具栏及保存按钮应保持可见");
  expect(longButton.x).toBeGreaterThanOrEqual(toolbarBox.x);
  expect(longButton.x + longButton.width).toBeLessThanOrEqual(toolbarBox.x + toolbarBox.width + 1);
  expect(longButton.height).toBeGreaterThan(44);
});
