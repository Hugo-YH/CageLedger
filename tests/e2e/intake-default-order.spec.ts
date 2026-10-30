import type { Page } from "@playwright/test";
import { ensureTestInfrastructure, expect, openNavigationEntry, test } from "./fixtures";

function listResponse(page: Page, offset: number, sortDir?: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/intake-batches" &&
      url.searchParams.get("view") === "summary" &&
      url.searchParams.get("offset") === String(offset) &&
      (sortDir === undefined ? !url.searchParams.has("sortKey") : url.searchParams.get("sortDir") === sortDir)
    );
  });
}

test("undetermined intake dates stay first across pages, filters and refresh while explicit sorting is preserved", async ({
  page,
}, testInfo) => {
  const health = await (await page.request.get("/api/health")).json();
  // Business fixtures are only written to the launcher's disposable E2E database.
  expect(health.database).toMatch(/cageledger-e2e-[^/]+\/cageledger\.sqlite$/);
  expect((await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } })).ok()).toBe(
    true,
  );
  await page.goto("/app");
  await ensureTestInfrastructure(page);
  const prefix = `ORDER-${Date.now()}`;
  const supplier = `${prefix}-supplier`;
  const ids: string[] = [];
  try {
    // Insert the dated records first: neither creation order nor a current-page
    // client sort can produce the required pending/date boundary on page two.
    for (let index = 0; index < 13; index += 1) {
      const id = `${prefix}-${String(index).padStart(2, "0")}`;
      const response = await page.request.post("/api/intake-batches", {
        data: {
          item: {
            id,
            batchNo: id,
            iacuc: "Z2026001",
            supplier,
            pi: "排序测试负责人",
            owner: "排序测试实验负责人",
            species: "mouse",
            quantity: 1,
            roomName: "8014",
            intakeDate: index === 0 ? "2099-10-01" : index === 1 ? "2099-11-02" : "",
            finalCardCount: 1,
            status: "pending_print",
            cards: [],
          },
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      ids.push(id);
    }
    const expected = [...ids.slice(2)].reverse().concat(ids[1], ids[0]);
    const initial = listResponse(page, 0);
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    expect((await initial).ok()).toBe(true);
    const list = page.getByRole("region", { name: "待接收批次列表" });
    const rows = list.locator("tbody tr[data-row-key]");
    const visibleIds = () =>
      rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-row-key")));
    await expect.poll(visibleIds).toEqual(expected.slice(0, 10));
    await expect(list.getByText("待定", { exact: true })).toHaveCount(10);

    const second = listResponse(page, 10);
    await page.locator(".intake-list-pagination .ant-pagination-item-2").click();
    expect((await second).ok()).toBe(true);
    await expect.poll(visibleIds).toEqual(expected.slice(10));
    await expect(list.getByText("待定", { exact: true })).toHaveCount(1);

    await page.getByRole("button", { name: "筛选购买单位", exact: true }).click();
    const filter = page.getByRole("group", { name: "筛选购买单位选项", exact: true });
    const supplierOption = filter.getByRole("checkbox", { name: new RegExp(supplier) });
    await expect(supplierOption).not.toBeChecked();
    await supplierOption.click();
    await expect(supplierOption).toBeChecked();
    const filtered = listResponse(page, 0);
    await filter.getByRole("button", { name: "应用", exact: true }).click();
    expect((await filtered).ok()).toBe(true);
    await expect.poll(visibleIds).toEqual(expected.slice(0, 10));
    const filteredSecond = listResponse(page, 10);
    await page.locator(".intake-list-pagination .ant-pagination-item-2").click();
    expect((await filteredSecond).ok()).toBe(true);
    await expect.poll(visibleIds).toEqual(expected.slice(10));
    await testInfo.attach("pending-date-boundary-on-page-two", {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    const refreshed = listResponse(page, 0);
    await page.reload();
    expect((await refreshed).ok()).toBe(true);
    await expect.poll(visibleIds).toEqual(expected.slice(0, 10));

    const ascending = listResponse(page, 0, "asc");
    await page.getByRole("button", { name: "接收日期，点击切换排序", exact: true }).click();
    expect((await ascending).ok()).toBe(true);
    await expect.poll(visibleIds).toEqual(expected.slice(0, 10));
    const descending = listResponse(page, 0, "desc");
    await page.getByRole("button", { name: "接收日期，点击切换排序", exact: true }).click();
    expect((await descending).ok()).toBe(true);
    await expect.poll(visibleIds).toEqual([ids[1], ids[0], ...expected.slice(0, 8)]);
  } finally {
    for (const id of ids) expect((await page.request.delete(`/api/intake-batches/${id}`)).ok()).toBe(true);
  }
});
