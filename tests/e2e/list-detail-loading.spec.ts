import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import { ensureTestInfrastructure, expect, openNavigationEntry, openSavedQuantitySheets, test } from "./fixtures";

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeHidden();
}

test("saved quantity loads edit detail and metadata together and retries metadata failure", async ({ page }) => {
  await login(page);
  await ensureTestInfrastructure(page);
  const id = randomUUID();
  const iacuc = `E2E-LAZY-${id}`;
  const created = await page.request.post("/api/quantity-sheets", {
    data: {
      sheet: {
        id,
        month: new Date().toISOString().slice(0, 7),
        roomId: "room-e2e-8014",
        roomName: "8014",
        manager: "系统管理员",
        iacuc,
        project: "按需加载项目",
        pi: "验收负责人",
        owner: "验收人",
        funding: "保留草稿经费",
        billingUnit: "cage_day",
        animalDetailEnabled: false,
        initialAnimalCount: 0,
        initialCageCount: 2,
        pageCount: 1,
        rows: [{ id: `${id}-row`, date: `${new Date().toISOString().slice(0, 7)}-01`, cageCount: 2 }],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  try {
    const pending: Record<string, Route> = {};
    let identityFails = true;
    for (const [name, pattern] of [
      ["detail", `**/api/quantity-sheets/${id}`],
      ["rooms", "**/api/quantity-sheet-rooms"],
      ["identities", "**/api/principal-identities"],
    ] as const) {
      await page.route(pattern, async (route) => {
        if (!identityFails) return route.fallback();
        pending[name] = route;
      });
    }
    await openSavedQuantitySheets(page);
    const row = page.getByRole("row").filter({ hasText: iacuc });
    await expect(row).toBeVisible();
    expect(Object.keys(pending)).toEqual([]);
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "编辑数量统计表" });
    await expect(dialog).toBeVisible();
    await expect.poll(() => Object.keys(pending).sort()).toEqual(["detail", "identities", "rooms"]);
    await Promise.all([
      pending.detail.fallback(),
      pending.rooms.fallback(),
      pending.identities.fulfill({ status: 403, json: { error: "负责人配置不可用" } }),
    ]);
    await expect(dialog.getByText("房间或负责人配置加载失败")).toBeVisible();
    identityFails = false;
    await dialog.getByRole("button", { name: "重新加载" }).click();
    await expect(dialog.getByRole("combobox", { name: "IACUC 编号" })).toHaveValue(iacuc.toUpperCase());
    await expect(dialog.getByLabel("支撑经费", { exact: true })).toHaveValue("保留草稿经费");
  } finally {
    await page.request.delete(`/api/quantity-sheets/${id}`);
  }
});

test("technical service list uses summary and detail is loaded on demand", async ({ page }) => {
  await login(page);
  const summary = {
    id: "lazy-service",
    month: "2026-10",
    iacuc: "Z-LAZY",
    pi: "懒加载负责人",
    facility: "zhujiang",
    serviceId: "lazy",
    serviceName: "测试服务",
    customerType: "internal",
    unit: "次",
    unitPrice: 10,
    totalAmount: 10,
    totalQuantity: 1,
    serviceDayCount: 1,
    protected: false,
    updatedAt: "2026-10-01",
  };
  const detail = {
    ...summary,
    project: "项目",
    owner: "实验人",
    funding: "经费",
    manager: "登记人",
    notes: "",
    rows: [{ date: "2026-10-01", quantity: 1, amount: 10 }],
    priceSnapshot: {
      id: "lazy",
      name: "测试服务",
      unit: "次",
      internalPrice: 10,
      externalPrice: 20,
      version: "v1",
      source: "验收",
      notes: "",
    },
  };
  let view = "";
  let detailCount = 0;
  let delayed: Route | undefined;
  await page.route("**/api/technical-services/sheets?**", async (route) => {
    view = new URL(route.request().url()).searchParams.get("view") || "";
    await route.fulfill({ json: { items: [summary], page: { total: 1, limit: 10, offset: 0, hasMore: false } } });
  });
  await page.route("**/api/technical-services/sheets/lazy-service", async (route) => {
    detailCount += 1;
    if (detailCount === 1) delayed = route;
    else if (detailCount === 2) await route.fulfill({ status: 403, json: { error: "明细不可用" } });
    else await route.fulfill({ json: { item: detail } });
  });
  await openNavigationEntry(page, "技术服务费管理", "已保存技术服务明细");
  const row = page.getByRole("row").filter({ hasText: "Z-LAZY" });
  await expect(row).toBeVisible();
  expect(view).toBe("summary");
  expect(detailCount).toBe(0);
  await row.getByRole("button", { name: "预览", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "技术服务明细预览" });
  await expect(preview).toBeVisible();
  await expect.poll(() => detailCount).toBe(1);
  await preview.getByRole("button", { name: "关闭", exact: true }).click();
  await delayed?.fulfill({ json: { item: detail } }).catch(() => undefined);
  await expect(preview).toBeHidden();
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "技术服务明细", exact: true });
  await expect(editor.getByText("技术服务明细读取失败")).toBeVisible();
  await editor.getByRole("button", { name: "重新加载" }).click();
  await expect(editor.locator("#service-iacuc")).toHaveValue("Z-LAZY");
  expect(detailCount).toBe(3);
});
