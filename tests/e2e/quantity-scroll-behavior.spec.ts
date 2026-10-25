import { expect, openSavedQuantitySheets, test } from "./fixtures";

test("native saved-list scrolling keeps the sticky toolbar and keyboard focus stable", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/quantity-sheets?*", (route) => {
    const url = new URL(route.request().url());
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("offset"));
    const items = Array.from({ length: 64 }, (_, index) => ({
      id: `native-${index}`,
      iacuc: `NATIVE-${index}`,
      month: "2026-09",
      pi: "测试负责人",
      manager: "测试登记",
      roomName: "隔离测试房间",
      updatedAt: "2026-09-30T08:00:00Z",
    }));
    return route.fulfill({ json: { items: items.slice(offset, offset + limit), page: { total: 64, offset, limit } } });
  });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await openSavedQuantitySheets(page);
  await page.getByLabel("每页显示条数").click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(".quantity-saved-list tbody tr[data-row-key]")).toHaveCount(20);
  await page.getByRole("checkbox", { name: "选择 NATIVE-0", exact: true }).check();
  const toolbar = page.locator(".quantity-saved-toolbar");
  await expect(toolbar).toHaveAttribute("data-sticky", "true");
  const list = page
    .getByRole("region", { name: "已保存数量统计表", exact: true })
    .and(page.locator('[data-ui="data-table"]'));
  const listHeight = await list.evaluate((element) => element.getBoundingClientRect().height);
  await list.focus();
  await page.keyboard.press("End");
  await expect
    .poll(() =>
      page
        .locator('[data-ui="workspace"]')
        .evaluate((owner) => owner.scrollTop === owner.scrollHeight - owner.clientHeight),
    )
    .toBe(true);
  const before = await page.locator('[data-ui="workspace"]').evaluate((owner) => owner.scrollTop);
  expect(before).toBeGreaterThan(300);
  await page.mouse.move(1100, 500);
  await page.mouse.wheel(0, -180);
  await expect
    .poll(() => page.locator('[data-ui="workspace"]').evaluate((owner) => owner.scrollTop))
    .toBeLessThan(before);
  const samples = await page.evaluate(async () => {
    const owner = document.querySelector<HTMLElement>('[data-ui="workspace"]')!;
    const toolbar = document.querySelector<HTMLElement>(".quantity-saved-toolbar")!;
    const result = [];
    for (let index = 0; index < 24; index++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      result.push({
        at: performance.now(),
        scrollTop: owner.scrollTop,
        toolbarTop: toolbar.getBoundingClientRect().top,
        listHeight: document.querySelector(".quantity-saved-list")!.getBoundingClientRect().height,
      });
    }
    return result;
  });
  expect(new Set(samples.map((sample) => sample.toolbarTop)).size).toBe(1);
  expect(samples.every((sample) => sample.listHeight === listHeight)).toBe(true);
  expect(samples.every((sample) => sample.scrollTop > 100)).toBe(true);
  await expect(list).toBeFocused();
  await info.attach("native-scroll-samples", {
    body: JSON.stringify({ before, listHeight, samples }, null, 2),
    contentType: "application/json",
  });
});
