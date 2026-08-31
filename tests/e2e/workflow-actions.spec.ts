import type { Route } from "@playwright/test";
import { expect, openWorkflowCenter, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
});

for (const status of ["statement_sent", "statement_archived", "statement_locked"]) {
  test(`${status} lock action shows errors and allows a deliberate retry`, async ({ page }) => {
    const action = status === "statement_locked" ? "解锁" : "锁定";
    const workflow = {
      id: "mock-lock",
      pi: "流程负责人",
      month: "2026-08",
      iacucs: [],
      totalAmount: 0,
      workflowStatus: status,
    };
    await page.route("**/api/billing-workflows?*", (route) =>
      route.fulfill({ json: { items: [workflow], page: { total: 1, limit: 10, offset: 0 } } }),
    );
    let writes = 0;
    let pending: Route | undefined;
    await page.route("**/api/billing-workflows/advance", (route) => {
      writes += 1;
      pending = route;
    });
    await openWorkflowCenter(page);
    const trigger = page
      .getByRole("row")
      .filter({ hasText: "流程负责人" })
      .getByRole("button", { name: action, exact: true });
    await trigger.click();
    const popup = page.getByRole("tooltip").filter({ hasText: `${action}该结算流程？` });
    const confirm = popup.getByRole("button", { name: action, exact: true });
    await confirm.click();
    await expect.poll(() => writes).toBe(1);
    await expect(trigger).toHaveClass(/ant-btn-loading/);
    await expect(trigger).toBeDisabled();
    await pending?.fulfill({ status: 403, json: { error: `${action}请求被拒绝` } });
    await expect(page.getByRole("alert")).toContainText(`${action}请求被拒绝`);
    await expect(trigger).toBeEnabled();
    await expect(popup).toBeHidden();
    await trigger.click();
    await confirm.click();
    await expect.poll(() => writes).toBe(2);
    await pending?.fulfill({ json: { ok: true, item: workflow } });
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("revoke keeps the reason on failure and ignores the success callback of a closed modal", async ({ page }) => {
  const workflow = {
    id: "mock-revoke",
    pi: "撤回负责人",
    month: "2026-08",
    iacucs: [],
    totalAmount: 0,
    workflowStatus: "statement_sent",
  };
  await page.route("**/api/billing-workflows?*", (route) =>
    route.fulfill({ json: { items: [workflow], page: { total: 1, limit: 10, offset: 0 } } }),
  );
  let writes = 0;
  let pending: Route | undefined;
  await page.route("**/api/billing-workflows/advance", (route) => {
    writes += 1;
    pending = route;
  });
  await openWorkflowCenter(page);
  const trigger = page.getByRole("button", { name: "撤回", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "撤回结算流程" });
  const submit = dialog.getByRole("button", { name: "确认撤回" });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel("撤回原因").fill("核对材料后重新发起");
  await submit.click();
  await expect.poll(() => writes).toBe(1);
  await expect(submit).toHaveClass(/ant-btn-loading/);
  await pending?.fulfill({ status: 403, json: { error: "暂时无法撤回" } });
  await expect(dialog.getByRole("alert")).toContainText("暂时无法撤回");
  await expect(dialog.getByLabel("撤回原因")).toHaveValue("核对材料后重新发起");
  await submit.click();
  await expect.poll(() => writes).toBe(2);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await pending?.fulfill({ json: { ok: true, item: workflow } });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("撤回原因")).toHaveValue("");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});
