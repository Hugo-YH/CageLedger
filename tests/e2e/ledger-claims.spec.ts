import { ensureTestInfrastructure, expect, openBillingNavigation, test } from "./fixtures";

let createdClaimId = "";

test.afterEach(async ({ page }) => {
  if (createdClaimId) {
    await page.request.delete(`/api/reimbursement-ledger/claims/${createdClaimId}`).catch(() => {});
  }
});

test("saved reimbursement claim can be deleted from the 报销单 list", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  const documentNumber = `BXD-E2E-DELETE-${Date.now()}`;
  const create = await page.request.post("/api/reimbursement-ledger/claims", {
    data: {
      documentNumber,
      status: "pending_submission",
      fundingLines: [{ fundBookNo: "F-E2E", fundingOwner: "E2E 经费负责人", reimbursementAmount: 88 }],
    },
  });
  const createBody = await create.json();
  createdClaimId = createBody.item?.id || "";
  expect(create.ok()).toBeTruthy();

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /结算与报销台账/ }).click();
  await expect(page.getByRole("heading", { name: "核销工作台", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "报销单" }).click();
  const row = page.getByRole("row", { name: new RegExp(documentNumber) });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "删除" }).click();
  await page.locator(".ant-popconfirm").getByRole("button", { name: "删除", exact: true }).click();
  await expect(row).toHaveCount(0, { timeout: 10_000 });
});
