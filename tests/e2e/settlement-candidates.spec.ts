import { ensureTestInfrastructure, expect, openBillingNavigation, test } from "./fixtures";

const month = new Date().toISOString().slice(0, 7);
const sheetIds = [
  "sheet-e2e-settlement-1",
  "sheet-e2e-settlement-2",
  "sheet-e2e-settlement-3",
  "sheet-e2e-settlement-4",
  "sheet-e2e-settlement-5",
  "sheet-e2e-settlement-6",
  "sheet-e2e-settlement-7",
];

test.afterEach(async ({ page }) => {
  for (const id of sheetIds) await page.request.delete(`/api/quantity-sheets/${id}`);
});

test("settlement candidates merge a principal investigator's IACUC sheets", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  for (const [index, id] of sheetIds.entries()) {
    const cageCount = index === 0 ? 6 : index === 1 ? 12 : 8;
    const pi = index < 2 ? "E2E 合表负责人" : index === 2 ? "E2E 批量负责人" : `E2E 分页负责人 ${index - 2}`;
    await page.request.post("/api/quantity-sheets", {
      data: {
        sheet: {
          id,
          month,
          roomId: "room-e2e-8014",
          roomName: "8014",
          manager: "系统管理员",
          iacuc: `E2E-SETTLEMENT-00${index + 1}`,
          project: `结算候选项目 ${index + 1}`,
          pi,
          owner: "E2E 实验负责人",
          funding: `E2E-FUND-${index + 1}`,
          fullExemption: index === 0,
          billingUnit: "cage_day",
          animalDetailEnabled: false,
          initialAnimalCount: 0,
          initialCageCount: cageCount,
          pageCount: 1,
          rows: [{ id: `${id}-row-1`, date: `${month}-01`, cageCount }],
        },
      },
    });
  }

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /按项目负责人结算/ }).click();
  await expect(page.getByRole("heading", { name: "项目负责人结算", exact: true })).toBeVisible();
  const row = page.getByRole("row", { name: /E2E 合表负责人/ });
  await expect(row).toContainText("E2E-SETTLEMENT-001");
  await expect(row).toContainText("E2E-SETTLEMENT-002");
  await expect(row).toContainText("系统管理员");
  await expect(row).toContainText("¥");
  await page.getByLabel("每页显示条数").click();
  await page.getByRole("option", { name: "5 条/页", exact: true }).click();
  await page.getByLabel("全选当前筛选结果结算项").check();
  const selectionSummary = page.getByLabel("结算批量操作").getByText(/已选 \d+ 项/, { exact: true });
  await expect(selectionSummary).toBeVisible();
  const selectedCount = Number((await selectionSummary.innerText()).match(/\d+/)?.[0]);
  expect(selectedCount).toBeGreaterThan(5);
  await page.locator(".ant-pagination-next").click();
  await expect(page.locator("table tbody tr").first().getByRole("checkbox")).toBeChecked();
  await page.locator(".ant-pagination-prev").click();
  await page.getByLabel("全选当前筛选结果结算项").uncheck();
  await page.getByLabel("每页显示条数").click();
  await page.getByRole("option", { name: "10 条/页", exact: true }).click();
  await row.getByRole("checkbox", { name: `选择 E2E 合表负责人 ${month} 结算项` }).check();
  const downloadPromise = page.waitForEvent("download");
  await page.getByLabel("结算批量操作").getByRole("button", { name: "导出 PDF", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    `E2E 合表负责人课题组实验动物饲养费核算汇总表 ${month.replace("-", "年")}月.pdf`,
  );
  const xlsxDownloadPromise = page.waitForEvent("download");
  await page.getByLabel("结算批量操作").getByRole("button", { name: "导出 Excel", exact: true }).click();
  const xlsxDownload = await xlsxDownloadPromise;
  expect(xlsxDownload.suggestedFilename()).toBe(
    `E2E 合表负责人课题组实验动物饲养费核算汇总表 ${month.replace("-", "年")}月.xlsx`,
  );
  await row.getByRole("button", { name: "预览结算单", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /E2E 合表负责人/ })).toBeVisible();
  await expect(page.frameLocator('iframe[title="结算单预览"]').locator("body")).toContainText(
    "E2E-SETTLEMENT-001（全额减免）",
  );
  const previewDialog = page.getByRole("dialog", { name: /E2E 合表负责人/ });
  await expect(previewDialog.getByRole("button", { name: "发起结算流程", exact: true })).toBeVisible();
  const closePdfFeedback = page.getByRole("button", { name: /关闭正在生成 PDF提示/ });
  if (await closePdfFeedback.isVisible()) await closePdfFeedback.click();
  await previewDialog.getByRole("button", { name: "关闭", exact: true }).click();

  const batchRow = page.getByRole("row", { name: /E2E 批量负责人/ });
  await batchRow.getByRole("checkbox", { name: `选择 E2E 批量负责人 ${month} 结算项` }).check();
  await page.getByLabel("结算批量操作").getByRole("button", { name: "批量发起结算", exact: true }).click();
  const confirmDialog = page.getByRole("dialog", { name: "批量发起结算流程", exact: true });
  await expect(confirmDialog).toContainText("2 个项目负责人结算项");
  await confirmDialog.getByRole("button", { name: "发起 2 个流程", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已发起 2 个结算流程" })).toBeVisible();
});
