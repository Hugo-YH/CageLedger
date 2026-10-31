import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, openNavigationEntry, openSettingsView, test } from "./fixtures";

test("reception list uses received batches, previews sources and downloads the real Excel on desktop and mobile", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1200, height: 900 });
  expect((await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } })).ok()).toBe(
    true,
  );
  const health = await (await page.request.get("/api/health")).json();
  expect(health.database).toContain("cageledger-e2e-");
  const id = `reception-e2e-${Date.now()}`;
  const pendingId = `${id}-pending`;
  for (const batchId of [id, pendingId]) {
    const save = await page.request.post("/api/intake-batches", {
      data: {
        item: {
          id: batchId,
          batchNo: batchId,
          iacuc: "Z-RECEPTION-UNMATCHED",
          purchaseOrderNo: "00001234567890123456789",
          supplier: "接收测试供应单位",
          pi: "预约旧负责人不能回填",
          owner: "预约旧实验人不能回填",
          roomName: "",
          intakeDate: "2026-10-30",
          quantity: 6,
          finalCardCount: 0,
          intakePurpose: "direct_sampling",
          species: "mouse",
          strainRaw: "ICR",
          sex: "雄性",
          status: "pending_receipt",
          cards: [],
        },
      },
    });
    expect(save.ok(), await save.text()).toBe(true);
  }
  expect((await page.request.post("/api/intake-batches/confirm-receipt", { data: { ids: [id] } })).ok()).toBe(true);
  const before = await (await page.request.get(`/api/intake-batches/${id}`)).json();
  try {
    await page.goto("/app");
    await openNavigationEntry(page, "接收管理", "接收列表");
    const region = page.getByRole("region", { name: "接收批次列表" });
    await expect(region.getByText(id, { exact: true })).toBeVisible();
    await expect(region.getByText(pendingId, { exact: true })).toHaveCount(0);
    await expect(region.getByText("预约旧负责人不能回填", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "导出Excel", exact: true })).toBeDisabled();
    await region.getByRole("checkbox", { name: `选择 ${id}`, exact: true }).check();
    expect(await region.evaluate((node) => node.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await region.getByRole("button", { name: "筛选批次编号", exact: true }).click();
    const filter = page.getByRole("group", { name: "筛选批次编号选项", exact: true });
    const option = filter.getByRole("checkbox", { name: new RegExp(id) });
    await option.click();
    await expect(option).toBeChecked();
    await filter.getByRole("button", { name: "应用", exact: true }).click();
    await expect(region.getByRole("checkbox", { name: `选择 ${id}`, exact: true })).not.toBeChecked();
    await expect(page.getByRole("button", { name: "导出Excel", exact: true })).toBeDisabled();
    await expect(region.getByRole("checkbox", { name: `选择 ${id}`, exact: true })).toBeEnabled();
    await region.getByRole("checkbox", { name: `选择 ${id}`, exact: true }).check();
    await page.screenshot({ path: testInfo.outputPath("reception-desktop-1200.png"), animations: "disabled" });
    let failPreview = true;
    await page.route("**/api/receptions/preview", async (route) => {
      if (failPreview) {
        failPreview = false;
        await route.fulfill({ status: 503, json: { error: "预览连接暂时失败" } });
      } else await route.fallback();
    });
    await page.getByRole("button", { name: "导出Excel", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "导出接收记录 Excel", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("导出预览加载失败", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "确认导出", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "重试", exact: true }).click();
    await expect(dialog.getByText("已选择 1 个批次，Excel 共 1 行", { exact: true })).toBeVisible();
    await expect(dialog.getByText("导出内容为来源预填，需人工核对", { exact: true })).toBeVisible();
    await dialog.getByText("查看字段来源", { exact: true }).click();
    await expect(dialog.getByText(/项目：未匹配/)).toBeVisible();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(region.getByRole("checkbox", { name: `选择 ${id}`, exact: true })).toBeChecked();
    await page.getByRole("button", { name: "导出Excel", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "确认导出", exact: true })).toBeEnabled();
    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "确认导出", exact: true }).click();
    const download = await downloadPromise;
    const file = testInfo.outputPath("reception-real.xlsx");
    await download.saveAs(file);
    expect((await readFile(file)).subarray(0, 2).toString()).toBe("PK");
    const cells = execFileSync(
      process.execPath,
      [
        "scripts/run_python.mjs",
        "-c",
        "import sys,openpyxl; s=openpyxl.load_workbook(sys.argv[1]).worksheets[0]; print(s['B4'].value); print(s['P4'].value)",
        file,
      ],
      { encoding: "utf8" },
    );
    expect(cells).toContain("00001234567890123456789");
    expect(cells).toContain("6");
    await expect(dialog).toBeHidden();
    await expect(page.getByText("接收记录 Excel 已导出", { exact: true }).last()).toBeVisible();
    expect(await (await page.request.get(`/api/intake-batches/${id}`)).json()).toEqual(before);
    await page.setViewportSize({ width: 390, height: 844 });
    await openNavigationEntry(page, "接收管理", "接收列表");
    await expect(page.getByRole("heading", { name: "接收列表", exact: true })).toBeVisible();
    await expect(page.locator(".ant-mobile-navigation-sheet")).toBeHidden();
    await expect(region.getByText(id, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("reception-mobile-390.png"), animations: "disabled" });
    await page.getByRole("button", { name: "导出Excel", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "确认导出", exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("reception-preview-mobile-390.png"), animations: "disabled" });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await page.setViewportSize({ width: 1200, height: 900 });
    await openSettingsView(page, "系统功能");
    const switchControl = page.getByRole("switch", { name: "接收管理", exact: true });
    await switchControl.click();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByText("系统功能设置已保存", { exact: true }).last()).toBeVisible();
    await expect(page.locator(".ant-main-menu").getByRole("menuitem", { name: /接收管理$/ })).toHaveCount(0);
    await expect(page.locator(".ant-main-menu").getByRole("menuitem", { name: /笼卡管理$/ })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: "更多", exact: true }).click();
    await expect(page.locator(".ant-mobile-navigation-sheet").getByText("接收管理", { exact: true })).toHaveCount(0);
    await expect(page.locator(".ant-mobile-navigation-sheet").getByText("笼卡管理", { exact: true })).toBeVisible();
  } finally {
    const features = await (await page.request.get("/api/system/features")).json();
    await page.request.put("/api/system/features", {
      data: { enabled: { ...features.item.enabled, reception: true }, expectedUpdatedAt: features.item.updatedAt },
    });
    for (const batchId of [id, pendingId]) await page.request.delete(`/api/intake-batches/${batchId}`);
  }
});
