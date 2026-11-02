import { expect, openNavigationEntry, test } from "./fixtures";

test("bulk receipt reviews per-batch dates, preserves drafts on failure and exposes actual dates in reception", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } });
  const health = await (await page.request.get("/api/health")).json();
  expect(health.database).toContain("cageledger-e2e-");
  const prefix = `receive-dates-${Date.now()}`;
  const ids = [`${prefix}-dated`, `${prefix}-undated`];
  const versions: Record<string, string> = {};
  for (const [index, id] of ids.entries()) {
    const save = await page.request.post("/api/intake-batches", {
      data: {
        item: {
          id,
          batchNo: id,
          iacuc: "Z2026001",
          supplier: "日期验证供应商",
          intakePurpose: "direct_sampling",
          pi: "项目负责人",
          owner: "实验负责人",
          intakeDate: index === 0 ? "2026-10-30" : "",
          status: "pending_receipt",
          quantity: 3,
          species: "mouse",
          finalCardCount: 0,
          receipts: [],
        },
      },
    });
    expect(save.ok(), await save.text()).toBe(true);
    versions[id] = (await save.json()).item.updatedAt;
  }
  try {
    const stale = await page.request.post("/api/intake-batches/confirm-receipt", {
      data: {
        ids,
        actualReceiptDates: Object.fromEntries(ids.map((id) => [id, "2026-11-01"])),
        expectedVersions: { ...versions, [ids[1]]: "stale" },
      },
    });
    expect(stale.status()).toBe(409);
    for (const id of ids) {
      const batch = (await (await page.request.get(`/api/intake-batches/${id}`)).json()).item;
      expect(batch.status).toBe("pending_receipt");
      expect(batch.receipts).toEqual([]);
    }
    await page.goto("/app");
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    for (const id of ids) await page.getByRole("checkbox", { name: `选择 ${id}`, exact: true }).check();
    await page.getByRole("button", { name: "标记已接收", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "确认实际接收日期", exact: true });
    await expect(dialog.getByLabel(`${ids[0]} 实际接收日期`, { exact: true })).toHaveValue("2026-10-30");
    await expect(dialog.getByLabel(`${ids[1]} 实际接收日期`, { exact: true })).toHaveValue("");
    await expect(dialog.getByRole("button", { name: "确认已接收", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    for (const id of ids) await expect(page.getByRole("checkbox", { name: `选择 ${id}`, exact: true })).toBeChecked();
    await page.getByRole("button", { name: "标记已接收", exact: true }).click();
    for (const [index, id] of ids.entries()) {
      const input = dialog.getByLabel(`${id} 实际接收日期`, { exact: true });
      await input.fill(index === 0 ? "2026-11-01" : "2026-11-02");
      await input.press("Enter");
    }
    await page.screenshot({ path: testInfo.outputPath("receipt-date-confirmation.png"), animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(dialog.getByRole("button", { name: "确认已接收", exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const bounds = await dialog.getByLabel(`${ids[0]} 实际接收日期`, { exact: true }).boundingBox();
        return bounds ? bounds.x + bounds.width : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(390);
    await page.screenshot({
      path: testInfo.outputPath("receipt-date-confirmation-mobile.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    let attempt = 0;
    await page.route("**/api/intake-batches/confirm-receipt", async (route) => {
      attempt += 1;
      if (attempt === 1) {
        await route.fulfill({ status: 409, json: { error: "所选批次已更新" } });
      } else if (attempt === 2) {
        await route.fulfill({ status: 503, json: { error: "测试接收连接中断" } });
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "确认已接收", exact: true }).click();
    await expect(dialog.getByText("所选批次已更新，请返回列表重新勾选后确认接收。", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "确认已接收", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "返回列表重新选择", exact: true }).click();
    for (const id of ids) {
      await expect(page.getByRole("checkbox", { name: `选择 ${id}`, exact: true })).not.toBeChecked();
      await page.getByRole("checkbox", { name: `选择 ${id}`, exact: true }).check();
    }
    await page.getByRole("button", { name: "标记已接收", exact: true }).click();
    for (const [index, id] of ids.entries()) {
      const input = dialog.getByLabel(`${id} 实际接收日期`, { exact: true });
      await input.fill(index === 0 ? "2026-11-01" : "2026-11-02");
      await input.press("Enter");
    }
    await dialog.getByRole("button", { name: "确认已接收", exact: true }).click();
    await expect(dialog.getByText("测试接收连接中断", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel(`${ids[1]} 实际接收日期`, { exact: true })).toHaveValue("2026-11-02");
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/api/intake-batches/confirm-receipt") && r.status() === 201,
    );
    await dialog.getByRole("button", { name: "确认已接收", exact: true }).click();
    const result = await (await response).json();
    expect(result.receipts).toHaveLength(2);
    expect(result.tasks).toEqual([]);
    await expect(dialog).toBeHidden();
    await openNavigationEntry(page, "接收管理", "接收列表");
    const region = page.getByRole("region", { name: "接收批次列表" });
    for (const [index, id] of ids.entries()) {
      const row = region.locator("tr", { hasText: id });
      await expect(row).toContainText(index === 0 ? "2026-11-01" : "2026-11-02");
      await expect(row).not.toContainText("原记录，待确认");
      const batch = (await (await page.request.get(`/api/intake-batches/${id}`)).json()).item;
      expect(batch.intakeDate).toBe(index === 0 ? "2026-10-30" : "");
      expect(batch.receipts).toHaveLength(1);
    }
  } finally {
    for (const id of ids) await page.request.delete(`/api/intake-batches/${id}`);
  }
});
