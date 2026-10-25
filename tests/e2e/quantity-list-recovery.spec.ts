import type { Page, Route, TestInfo } from "@playwright/test";
import { expect, openSavedQuantitySheets, test } from "./fixtures";

const sheets = Array.from({ length: 64 }, (_, index) => ({
  id: `list-recovery-${index + 1}`,
  month: "2026-09",
  iacuc: `LIST-${String(index + 1).padStart(3, "0")}`,
  roomName: "隔离测试房间",
  manager: "测试登记",
  pi: "测试负责人",
  updatedAt: "2026-09-30T08:00:00Z",
}));
async function respond(route: Route, total = sheets.length) {
  const url = new URL(route.request().url());
  const offset = Number(url.searchParams.get("offset"));
  const limit = Number(url.searchParams.get("limit"));
  await route.fulfill({
    json: { items: sheets.slice(0, total).slice(offset, offset + limit), page: { total, offset, limit } },
  });
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}
async function scrollPosition(page: Page, set = false) {
  return page.evaluate((set) => {
    const workspace = document.querySelector<HTMLElement>("[data-ui=workspace]");
    const target =
      workspace && /(auto|scroll)/.test(getComputedStyle(workspace).overflowY) ? workspace : document.scrollingElement!;
    if (set) target.scrollTop = Math.min(180, target.scrollHeight - target.clientHeight);
    return target.scrollTop;
  }, set);
}
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
});

test("initial failure is not an empty list and keyboard retry is single-flight", async ({ page }, info) => {
  let recovered = false;
  let requests = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/quantity-sheets?*", async (route) => {
    requests++;
    if (!recovered) return route.fulfill({ status: 503, json: { error: "隔离列表不可用" } });
    await gate;
    await respond(route);
  });
  await openSavedQuantitySheets(page);
  const error = page.getByRole("alert").filter({ hasText: "无法加载数量统计表列表" });
  await expect(error).toContainText("隔离列表不可用");
  expect(requests).toBe(2); // Existing Query read policy retries a transient error once.
  await expect(page.getByText("共 0 条", { exact: true })).toHaveCount(0);
  await expect(page.locator(".quantity-saved-list")).toHaveCount(0);
  await screenshot(page, info, "after-initial-error");
  recovered = true;
  const retry = error.getByRole("button", { name: "重试", exact: true });
  await retry.focus();
  await retry.press("Enter");
  await expect.poll(() => requests).toBe(3);
  await page.keyboard.press("Enter");
  expect(requests).toBe(3);
  release();
  await expect(page.getByRole("checkbox", { name: "选择 LIST-001", exact: true })).toBeEnabled();
  await expect(error).toBeHidden();
});

test("failed pagination retains rows and selection but blocks stale actions until retry", async ({ page }, info) => {
  let fail = false;
  let requests = 0;
  await page.route("**/api/quantity-sheets?*", async (route) => {
    requests++;
    if (fail) return route.fulfill({ status: 503, json: { error: "隔离分页不可用" } });
    await respond(route);
  });
  await openSavedQuantitySheets(page);
  const selected = page.getByRole("checkbox", { name: "选择 LIST-001", exact: true });
  await selected.check();
  fail = true;
  await page.locator('.quantity-saved-pagination [title="2"]').click();
  const error = page.getByRole("alert").filter({ hasText: "列表更新失败" });
  await expect(error).toBeVisible();
  await expect(page.locator(".quantity-saved-list tbody tr[data-row-key]")).toHaveCount(10);
  await expect(selected).toBeChecked();
  await expect(selected).toBeDisabled();
  for (const name of ["编辑", "删除"])
    await expect(
      page.locator(".quantity-saved-list").getByRole("button", { name, exact: true }).first(),
    ).toBeDisabled();
  await expect(page.getByRole("button", { name: "导出 PDF", exact: true })).toBeDisabled();
  await expect(page.getByText("共 0 条", { exact: true })).toHaveCount(0);
  await screenshot(page, info, "after-page-error");
  const count = requests;
  fail = false;
  await error.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "选择 LIST-011", exact: true })).toBeEnabled();
  expect(requests).toBe(count + 1);
  await expect(page.getByText("已选 1 项", { exact: true })).toBeVisible();
});

test("background refresh error retains cached rows and confirms no repeated writes", async ({ page }, info) => {
  let fail = false;
  let writes = 0;
  await page.route("**/api/quantity-sheets?*", (route) =>
    fail ? route.fulfill({ status: 503, json: { error: "隔离后台刷新失败" } }) : respond(route),
  );
  await page.route("**/api/quantity-sheets/list-recovery-1", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    writes++;
    fail = true;
    await route.fulfill({ json: { ok: true } });
  });
  await openSavedQuantitySheets(page);
  const row = page.locator('tr[data-row-key="list-recovery-1"]');
  await row.getByRole("button", { name: "删除", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除数量统计表", exact: true });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(writes).toBe(0);
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  const error = page.getByRole("alert").filter({ hasText: "列表更新失败" });
  await expect(error).toContainText("隔离后台刷新失败");
  await expect(row.getByRole("button", { name: "编辑", exact: true })).toBeDisabled();
  await expect(page.locator(".quantity-saved-list tbody tr[data-row-key]")).toHaveCount(10);
  expect(writes).toBe(1);
  await screenshot(page, info, "after-refresh-error");
  fail = false;
  await error.getByRole("button", { name: "重试", exact: true }).click();
  await expect(row.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
  expect(writes).toBe(1);
});

test("workspace return restores applied preferences and scroll without bulk selection", async ({ page }, info) => {
  const requests: URL[] = [];
  await page.route("**/api/quantity-sheets?*", async (route) => {
    requests.push(new URL(route.request().url()));
    await respond(route);
  });
  await page.route("**/api/filter-options?*", (route) =>
    route.fulfill({ json: { items: [{ value: "2026-09", label: "2026-09", count: 64 }] } }),
  );
  await openSavedQuantitySheets(page);
  await page.getByRole("button", { name: "筛选月份", exact: true }).click();
  const filter = page.getByRole("group", { name: "筛选月份选项", exact: true });
  await expect(filter).toHaveAttribute("aria-busy", "false");
  await filter.getByRole("checkbox").click();
  await expect(filter.getByRole("checkbox")).toBeChecked();
  await filter.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByRole("button", { name: "筛选月份", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "IACUC，点击切换排序", exact: true }).click();
  await page.getByLabel("每页显示条数").click();
  await page.getByRole("option", { name: "20 条/页", exact: true }).click();
  await page.locator('.quantity-saved-pagination [title="2"]').click();
  await expect(page.getByRole("checkbox", { name: "选择 LIST-021", exact: true })).toBeEnabled();
  await page.getByRole("checkbox", { name: "选择 LIST-021", exact: true }).check();
  const before = await scrollPosition(page, true);
  expect(before).toBeGreaterThan(0);
  const params = requests.at(-1)!.search;
  await page.getByRole("menuitem", { name: /总览$/ }).click();
  await openSavedQuantitySheets(page);
  await expect(page.getByRole("checkbox", { name: "选择 LIST-021", exact: true })).toBeEnabled();
  await expect(page.getByRole("checkbox", { name: "选择 LIST-021", exact: true })).not.toBeChecked();
  await expect(page.locator(".quantity-saved-pagination .ant-pagination-item-active")).toHaveText("2");
  await expect.poll(() => scrollPosition(page)).toBe(before);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  expect(await scrollPosition(page)).toBe(before);
  expect(requests.at(-1)!.search).toBe(params);
  await screenshot(page, info, "after-workspace-return");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await openSavedQuantitySheets(page);
  await expect(page.getByRole("checkbox", { name: "选择 LIST-001", exact: true })).toBeEnabled();
  const reset = requests.at(-1)!;
  expect(reset.searchParams.get("offset")).toBe("0");
  expect(reset.searchParams.get("limit")).toBe("10");
  expect(reset.searchParams.get("sortKey")).toBe("month");
  expect(reset.searchParams.get("columnFilters")).toBeNull();
});

test("a fresh smaller result corrects the page, while cancelled late results cannot replace it", async ({ page }) => {
  let total = 24;
  let held: Route | undefined;
  let hold = false;
  await page.route("**/api/quantity-sheets?*", async (route) => {
    if (hold) {
      held = route;
      return;
    }
    await respond(route, total);
  });
  await page.route("**/api/quantity-sheets/list-recovery-21", async (route) => {
    total = 3;
    await route.fulfill({ json: { ok: true } });
  });
  await openSavedQuantitySheets(page);
  await page.locator('.quantity-saved-pagination [title="3"]').click();
  await page.locator('tr[data-row-key="list-recovery-21"]').getByRole("button", { name: "删除", exact: true }).click();
  await page
    .getByRole("dialog", { name: "删除数量统计表", exact: true })
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  await expect(page.locator(".quantity-saved-list tbody tr[data-row-key]")).toHaveCount(3);
  await expect(page.locator(".quantity-saved-pagination .ant-pagination-item-active")).toHaveText("1");
  hold = true;
  await page.getByRole("button", { name: "IACUC，点击切换排序", exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await page.getByRole("menuitem", { name: /总览$/ }).click();
  hold = false;
  await respond(held!, 64);
  await openSavedQuantitySheets(page);
  await expect(page.locator(".quantity-saved-list tbody tr[data-row-key]")).toHaveCount(3);
  await expect(page.getByText("共 3 条", { exact: true }).first()).toBeVisible();
});

test("the five page sizes support mouse, keyboard and cancellation without losing the list", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/api/quantity-sheets?*", async (route) => {
    requests.push(new URL(route.request().url()));
    await respond(route);
  });
  await openSavedQuantitySheets(page);
  await expect(page.getByRole("checkbox", { name: "选择 LIST-001", exact: true })).toBeEnabled();
  const size = page.getByLabel("每页显示条数");
  await size.click();
  await page.getByRole("option", { name: "20 条/页", exact: true }).click();
  await expect(page.locator(".quantity-saved-list tbody tr[data-row-key]")).toHaveCount(20);
  await size.click();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.locator(".quantity-saved-list tbody tr[data-row-key]")).toHaveCount(10);
  await expect(size).toBeFocused();
  const before = requests.length;
  await size.click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option", { name: "20 条/页", exact: true })).toBeHidden();
  await expect(size).toBeFocused();
  await expect(page.locator(".quantity-saved-list tbody tr[data-row-key]")).toHaveCount(10);
  expect(requests).toHaveLength(before);
  // Returning to 10 uses the still-fresh Query cache; the last HTTP request
  // can legitimately remain the earlier request for 20.
  await expect(page.locator(".quantity-saved-pagination .ant-select-content")).toHaveAttribute("title", "10 条/页");
  await expect(page.locator(".quantity-saved-pagination .ant-pagination-item-active")).toHaveText("1");
  for (const count of [5, 50, 100]) {
    await size.click();
    let activeLabel = "";
    for (let step = 0; step < 6; step++) {
      activeLabel = await size.evaluate((input) => {
        const id = input.getAttribute("aria-activedescendant");
        return id ? document.getElementById(id)?.getAttribute("title") || "" : "";
      });
      if (activeLabel === `${count} 条/页`) break;
      await page.keyboard.press(Number.parseInt(activeLabel, 10) > count ? "ArrowUp" : "ArrowDown");
    }
    expect(activeLabel).toBe(`${count} 条/页`);
    await page.keyboard.press("Enter");
    await expect(page.locator(".quantity-saved-list tbody tr[data-row-key]")).toHaveCount(
      Math.min(count, sheets.length),
    );
    await expect(page.locator(".quantity-saved-pagination .ant-select-content")).toHaveAttribute(
      "title",
      `${count} 条/页`,
    );
    expect(requests.at(-1)?.searchParams.get("limit")).toBe(String(count));
  }
});
