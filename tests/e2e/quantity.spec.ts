import { ensureTestInfrastructure, expect, openQuantityEntry, openSavedQuantitySheets, test } from "./fixtures";

const bulkSheetIds = Array.from({ length: 7 }, (_, index) => `sheet-e2e-quantity-bulk-${index + 1}`);

test.afterEach(async ({ page }) => {
  for (const id of bulkSheetIds) await page.request.delete(`/api/quantity-sheets/${id}`);
});

test("save and delete a quantity sheet in the ephemeral database", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  const existingSheets = await page.request.get("/api/quantity-sheets?limit=100&offset=0");
  const existingPayload = (await existingSheets.json()) as { items: Array<{ id: string; iacuc: string }> };
  await Promise.all(
    existingPayload.items
      .filter((sheet) => sheet.iacuc === "E2E-IACUC-001")
      .map((sheet) => page.request.delete(`/api/quantity-sheets/${sheet.id}`)),
  );
  await openQuantityEntry(page);
  const iacucInput = page.getByRole("combobox", { name: "IACUC 编号", exact: true });
  await iacucInput.fill("Z202506");
  await expect(page.locator('#quantity-iacuc-options option[value="Z2025063"]')).toHaveCount(1);
  await page.getByRole("combobox", { name: "房间号", exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").getByRole("option", { name: "8014", exact: true }).click();
  await expect(page.getByLabel("登记人员", { exact: true })).toHaveValue("系统管理员");
  await expect(page.getByLabel("登记人员", { exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("房间管理员", { exact: true })).toHaveValue("E2E 房间管理员");
  await expect(page.getByLabel("房间管理员", { exact: true })).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: /计费扩展选项/ }).click();
  await page.getByRole("switch", { name: "全额减免", exact: true }).check();
  await iacucInput.fill("E2E-IACUC-001");
  await page.locator("form").getByLabel("项目负责人", { exact: true }).fill("E2E负责人");
  await page.getByLabel("第 1 行结余笼数", { exact: true }).fill("2");
  await page.getByRole("button", { name: "保存统计表", exact: true }).click();
  await expect(page.getByRole("heading", { name: "确认保存数量统计表", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("统计表已保存");
  await expect(page.getByRole("combobox", { name: "房间号", exact: true })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "IACUC 编号", exact: true })).toHaveValue("");
  await expect(page.locator("form").getByLabel("项目负责人", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("第 1 行结余笼数", { exact: true })).toHaveValue("");

  await openSavedQuantitySheets(page);
  await expect(page.getByRole("heading", { level: 2, name: "已保存数量统计表", exact: true })).toBeVisible();
  const savedRow = page.getByRole("row", { name: /E2E-IACUC-001/ });
  await expect(savedRow).toBeVisible();
  await expect(savedRow).toContainText("系统管理员");
  await savedRow.getByRole("checkbox", { name: "选择 E2E-IACUC-001" }).check();
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".quantity-saved-panel").getByRole("button", { name: "导出 PDF", exact: true }).click();
  const download = await downloadPromise;
  const now = new Date();
  const pdfMonth = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, "0")}月`;
  expect(download.suggestedFilename()).toBe(`实验动物数量统计表 ${pdfMonth} E2E-IACUC-001.pdf`);
  await savedRow.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(savedRow).toHaveCount(0);
});

test("selects every saved quantity sheet across result pages", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  const month = new Date().toISOString().slice(0, 7);
  for (const [index, id] of bulkSheetIds.entries()) {
    await page.request.post("/api/quantity-sheets", {
      data: {
        sheet: {
          id,
          month,
          roomId: "room-e2e-8014",
          roomName: "8014",
          manager: "系统管理员",
          iacuc: `E2E-IACUC-BULK-${index + 1}`,
          project: `批量选择统计表 ${index + 1}`,
          pi: `E2E 批量负责人 ${index + 1}`,
          owner: "E2E 实验负责人",
          funding: `E2E-FUND-BULK-${index + 1}`,
          billingUnit: "cage_day",
          animalDetailEnabled: false,
          initialAnimalCount: 0,
          initialCageCount: 2,
          pageCount: 1,
          rows: [{ id: `${id}-row`, date: `${month}-01`, cageCount: 2 }],
        },
      },
    });
  }

  await page.reload();
  await openSavedQuantitySheets(page);
  await page.getByLabel("每页显示条数").click();
  await page.getByRole("option", { name: "5 条/页", exact: true }).click();
  await page.getByLabel("全选当前筛选结果统计表").check();
  const selectionSummary = page.locator(".quantity-saved-panel .ant-tag");
  await expect(selectionSummary).toHaveText(/^\d+ 条 · 已选 \d+$/);
  const summaryMatch = (await selectionSummary.innerText()).match(/^(\d+) 条 · 已选 (\d+)$/);
  expect(summaryMatch).not.toBeNull();
  // Other specs create and delete sheets against the shared test database. The selected
  // snapshot remains valid when its source list changes between the two requests.
  expect(Number(summaryMatch?.[2])).toBeGreaterThanOrEqual(bulkSheetIds.length);
  expect(Number(summaryMatch?.[2])).toBeLessThanOrEqual(Number(summaryMatch?.[1]));
  await page.locator(".ant-pagination-next").click();
  await expect(page.locator(".quantity-saved-table tbody tr").first().getByRole("checkbox")).toBeChecked();
});
