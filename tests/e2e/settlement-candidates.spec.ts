import { ensureTestInfrastructure, expect, test } from "./fixtures";

const month = new Date().toISOString().slice(0, 7);
const sheetIds = ["sheet-e2e-settlement-1", "sheet-e2e-settlement-2"];

test.afterEach(async ({ page }) => {
  for (const id of sheetIds) await page.request.delete(`/api/quantity-sheets/${id}`);
});

test("settlement candidates merge a principal investigator's IACUC sheets", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  for (const [index, id] of sheetIds.entries()) {
    const cageCount = index === 0 ? 6 : 12;
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
          pi: "E2E 合表负责人",
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
  await page.getByRole("button", { name: "饲养费管理", exact: true }).click();
  await page.getByRole("button", { name: /按项目负责人结算/ }).click();
  await expect(page.getByRole("heading", { name: "项目负责人结算列表", exact: true })).toBeVisible();
  const row = page.getByRole("row", { name: /E2E 合表负责人/ });
  await expect(row).toContainText("E2E-SETTLEMENT-001");
  await expect(row).toContainText("E2E-SETTLEMENT-002");
  await expect(row).toContainText("¥");
  await row.getByRole("button", { name: "预览结算单", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /E2E 合表负责人/ })).toBeVisible();
  await expect(page.frameLocator('iframe[title="结算单预览"]').locator("body")).toContainText(
    "E2E-SETTLEMENT-001（全额减免）",
  );
  await expect(page.getByRole("button", { name: "发起结算流程", exact: true })).toBeVisible();
});
