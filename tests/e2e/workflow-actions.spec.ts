import type { Page, Route } from "@playwright/test";
import { expect, openWorkflowCenter, test } from "./fixtures";

async function mockPagedWorkflows(page: Page) {
  const workflows = Array.from({ length: 12 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      id: `mock-page-${number}`,
      pi: `分页负责人 ${number}`,
      month: "2026-08",
      iacucs: [],
      totalAmount: 0,
      workflowStatus: "statement_sent",
    };
  });
  await page.route("**/api/billing-workflows?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const filters = JSON.parse(params.get("columnFilters") || "{}") as Record<string, string[]>;
    const filtered = workflows.filter((item) => !filters.pi?.length || filters.pi.includes(item.pi));
    if (params.get("sortKey") === "pi") {
      filtered.sort((left, right) => left.pi.localeCompare(right.pi) * (params.get("sortDir") === "desc" ? -1 : 1));
    }
    const limit = Number(params.get("limit") || 10);
    const offset = Number(params.get("offset") || 0);
    return route.fulfill({
      json: { items: filtered.slice(offset, offset + limit), page: { total: filtered.length, limit, offset } },
    });
  });
  await page.route("**/api/filter-options?*", (route) =>
    route.fulfill({ json: { items: workflows.map((item) => ({ value: item.pi, label: item.pi, count: 1 })) } }),
  );
  return workflows;
}

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

test("batch locking keeps selected workflows across pages, page sizes and sorting after selection is cleared", async ({
  page,
}) => {
  const workflows = await mockPagedWorkflows(page);
  const writes: Array<{ workflowId: string; toStatus: string }> = [];
  let releaseFirst!: () => void;
  const firstWrite = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route("**/api/billing-workflows/advance", async (route) => {
    const payload = route.request().postDataJSON() as { workflowId: string; toStatus: string };
    writes.push(payload);
    if (writes.length === 1) await firstWrite;
    const workflow = workflows.find((item) => item.id === payload.workflowId);
    if (workflow) workflow.workflowStatus = payload.toStatus;
    await route.fulfill({ json: { ok: true, item: workflow } });
  });
  await openWorkflowCenter(page);
  const panel = page.getByRole("region", { name: "结算流程列表", exact: true });
  const toolbar = page.getByRole("group", { name: "结算流程批量操作", exact: true });
  await page.getByRole("checkbox", { name: "选择 分页负责人 01 2026-08 结算流程", exact: true }).check();
  await panel.locator(".ant-pagination-next").click();
  await page.getByRole("checkbox", { name: "选择 分页负责人 11 2026-08 结算流程", exact: true }).check();
  await expect(toolbar).toContainText("已选 2 项");
  await page.getByLabel("每页显示条数").click();
  await page.getByRole("option", { name: "5 条/页", exact: true }).click();
  await expect(toolbar).toContainText("已选 2 项");
  await expect(page.getByRole("checkbox", { name: "选择 分页负责人 01 2026-08 结算流程", exact: true })).toBeChecked();
  const sort = page.getByRole("button", { name: "项目负责人，点击切换排序", exact: true });
  await sort.click();
  await sort.click();
  await expect(page.getByRole("checkbox", { name: "选择 分页负责人 11 2026-08 结算流程", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "选择 分页负责人 01 2026-08 结算流程", exact: true })).toHaveCount(0);
  await expect(toolbar).toContainText("已选 2 项");
  await toolbar.getByRole("button", { name: "批量锁定", exact: true }).click();
  const confirmation = page.getByRole("tooltip").filter({ hasText: "批量锁定 2 条结算流程？" });
  await confirmation.getByRole("button", { name: "批量锁定", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  await toolbar.getByRole("button", { name: "清空选择", exact: true }).click();
  await expect(toolbar).toContainText("已选 0 项");
  await expect(toolbar).toContainText("正在处理");
  releaseFirst();
  await expect(page.getByRole("status").filter({ hasText: "已锁定 2 条结算流程。" })).toBeVisible();
  expect(writes.map((payload) => payload.workflowId)).toEqual(["mock-page-01", "mock-page-11"]);
  expect(writes.every((payload) => payload.toStatus === "statement_locked")).toBe(true);
});

test("applying a workflow filter clears the selection and discards an unconfirmed batch lock", async ({ page }) => {
  const workflows = await mockPagedWorkflows(page);
  const writes: string[] = [];
  await page.route("**/api/billing-workflows/advance", (route) => {
    const payload = route.request().postDataJSON() as { workflowId: string };
    writes.push(payload.workflowId);
    return route.fulfill({ json: { ok: true, item: workflows.find((item) => item.id === payload.workflowId) } });
  });
  await openWorkflowCenter(page);
  const toolbar = page.getByRole("group", { name: "结算流程批量操作", exact: true });
  await page.getByRole("checkbox", { name: "选择 分页负责人 01 2026-08 结算流程", exact: true }).check();
  await toolbar.getByRole("button", { name: "批量锁定", exact: true }).click();
  const confirmation = page.getByRole("tooltip").filter({ hasText: "批量锁定 1 条结算流程？" });
  await expect(confirmation).toBeVisible();
  await page.getByRole("button", { name: "筛选项目负责人", exact: true }).click();
  const filterPanel = page.locator(".table-filter-panel:visible");
  await filterPanel.getByRole("checkbox", { name: /分页负责人 12/ }).check();
  await expect(toolbar).toContainText("已选 1 项");
  await filterPanel.getByRole("button", { name: "应用", exact: true }).click();
  await expect(toolbar).toContainText("已选 0 项");
  await expect(page.getByText("范围已变化，已清空选择", { exact: true })).toBeVisible();
  await expect(confirmation).toBeHidden();
  await expect(toolbar.getByRole("button", { name: "批量锁定", exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
  await page.getByRole("checkbox", { name: "选择 分页负责人 12 2026-08 结算流程", exact: true }).check();
  await toolbar.getByRole("button", { name: "批量锁定", exact: true }).click();
  await confirmation.getByRole("button", { name: "批量锁定", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已锁定 1 条结算流程。" })).toBeVisible();
  expect(writes).toEqual(["mock-page-12"]);
});
