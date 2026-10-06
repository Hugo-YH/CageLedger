import { expect, openQuantityEntry, openSavedQuantitySheets, test } from "./fixtures";

test("full-balance custom pricing saves without a fixed count and restores on edit", async ({ page }, testInfo) => {
  const login = await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } });
  expect(login.ok()).toBe(true);
  const room = await page.request.post("/api/rooms", {
    data: {
      item: {
        id: "room-custom-all",
        name: "E2E 全部自定义兔房",
        facility: "bioisland",
        defaultSpecies: "rabbit",
        defaultBillingItem: "rabbit",
        defaultCustomerType: "internal",
        roomManager: "测试管理员",
      },
    },
  });
  expect(room.ok()).toBe(true);
  await page.goto("/app");
  await openQuantityEntry(page);
  await page.getByRole("combobox", { name: "房间号", exact: true }).click();
  await page.locator(".ant-select-dropdown").getByText("E2E 全部自定义兔房", { exact: true }).click();
  await page.getByRole("combobox", { name: "IACUC 编号", exact: true }).fill("E2E-ALL-CUSTOM");
  await page.locator("form").getByLabel("项目负责人", { exact: true }).fill("E2E 全部自定义负责人");
  await page.getByLabel("第 1 行结余总数", { exact: true }).fill("47");
  await page.getByRole("button", { name: /计费扩展选项/ }).click();
  await page.getByRole("button", { name: "新增区间", exact: true }).click();
  const segment = page.locator(".custom-billing-segment");
  const all = segment.getByRole("switch", { name: "区间 1 全部动物按自定义收费", exact: true });
  await expect(all).not.toBeChecked();
  await expect(segment.getByPlaceholder("每日数量")).toBeVisible();
  await all.check();
  await expect(segment.getByPlaceholder("每日数量")).toHaveCount(0);
  await expect(segment).toContainText("当天全部实际结余");
  await all.uncheck();
  await expect(segment.getByPlaceholder("每日数量")).toHaveValue("");
  await all.check();
  await segment.getByPlaceholder("收费单价").fill("3");
  await segment.getByLabel("收费说明", { exact: true }).fill("全部按每日实际结余");
  await segment.screenshot({ path: testInfo.outputPath("custom-all-pricing.png") });
  await page.getByRole("button", { name: "保存统计表", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "确认保存数量统计表", exact: true });
  await expect(confirm).toBeVisible();
  const savedResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/quantity-sheets") && response.request().method() === "POST",
  );
  await confirm.getByRole("button", { name: "确认保存", exact: true }).click();
  const response = await savedResponse;
  expect(response.status()).toBe(201);
  const { item } = await response.json();
  expect(item.customBillingSegments[0]).toMatchObject({ quantityMode: "all", quantity: null, unitPrice: 3 });
  await expect(page.getByRole("status")).toContainText("统计表已保存");
  const read = await page.request.get(`/api/quantity-sheets/${item.id}`);
  expect((await read.json()).item.customBillingSegments).toEqual(item.customBillingSegments);
  const overlap = await page.request.put(`/api/quantity-sheets/${item.id}`, {
    data: {
      expectedUpdatedAt: item.updatedAt,
      sheet: {
        ...item,
        customBillingSegments: [
          ...item.customBillingSegments,
          { ...item.customBillingSegments[0], id: "overlap", quantityMode: "fixed", quantity: 1 },
        ],
      },
    },
  });
  expect(overlap.status()).toBe(400);
  expect((await overlap.json()).error).toContain("区间不能与其他自定义收费区间重叠");
  const afterRejectedSave = await page.request.get(`/api/quantity-sheets/${item.id}`);
  expect((await afterRejectedSave.json()).item.customBillingSegments).toEqual(item.customBillingSegments);
  const audits = await page.request.get("/api/audit-events?limit=100&offset=0");
  const { items: auditItems } = await audits.json();
  expect(
    auditItems
      .filter((event: { entityId: string; action: string }) => event.entityId === item.id)
      .map((event: { action: string }) => event.action),
  ).toEqual(["quantity_sheet.created"]);
  await openSavedQuantitySheets(page);
  await page
    .getByRole("row", { name: /E2E-ALL-CUSTOM/ })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await expect(page.getByRole("switch", { name: "区间 1 全部动物按自定义收费", exact: true })).toBeChecked();
  await expect(page.getByPlaceholder("每日数量")).toHaveCount(0);
});
