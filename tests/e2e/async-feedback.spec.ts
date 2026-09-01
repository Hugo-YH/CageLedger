import type { Route } from "@playwright/test";
import { expect, openBillingNavigation, openWorkflowCenter, test } from "./fixtures";

const candidates = ["甲", "乙"].map((pi, index) => ({
  id: `candidate-${index}`,
  month: "2026-08",
  pi,
  iacucs: [`Z202600${index}`],
  manager: "登记人员",
  totalAmount: 20,
}));
const workflows = candidates.map((candidate) => ({
  ...candidate,
  id: `workflow-${candidate.id}`,
  workflowStatus: "statement_archived",
}));
const list = { items: candidates, page: { total: 2, limit: 10, offset: 0 }, filterOptions: {} };

for (const recording of [false, true]) {
  test(`${recording ? "recording" : "registration"} keeps errors, guards duplicate writes, and resets a reopened form`, async ({
    page,
  }, testInfo) => {
    const workflow = {
      ...workflows[0],
      workflowStatus: recording ? "statement_archived" : "statement_sent",
      reimbursementFormReturned: false,
    };
    await page.route("**/api/billing-workflows?*", (route) =>
      route.fulfill({ json: { items: [workflow], page: { ...list.page, total: 1 } } }),
    );
    await page.route("**/api/billing-workflows/*/funding-options", (route) =>
      route.fulfill({ json: { items: [], piFundingBookNos: [], piFundingBookOptions: [] } }),
    );
    let writes = 0;
    let pending: Route | undefined;
    const endpoint = recording
      ? `**/api/billing-workflows/${workflow.id}/reimbursement-forms`
      : "**/api/billing-workflows/advance";
    await page.route(endpoint, (route) => {
      writes += 1;
      pending = route;
    });
    await openWorkflowCenter(page);
    const row = page.getByRole("row").filter({ hasText: "甲" });
    const trigger = row.getByRole("button", { name: recording ? "查看" : "登记", exact: true });
    const detailDialog = page.getByRole("dialog").filter({ hasText: "流程记录" }).first();
    const openForm = async () => {
      if (!recording) {
        await trigger.click();
        return;
      }
      if ((await detailDialog.count()) === 0) await trigger.click();
      await detailDialog.getByRole("button", { name: "补录报销单", exact: true }).click();
    };
    await openForm();
    const dialog = page
      .getByRole("dialog")
      .filter({ hasText: recording ? "补录报销单" : "交回登记" })
      .first();
    if (!recording) {
      await dialog.getByRole("switch", { name: "饲养费结算单", exact: true }).click();
      await dialog.getByRole("switch", { name: "报销单", exact: true }).click();
    }
    const formNo = dialog.getByRole("textbox", { name: /报销单号/ });
    await formNo.fill("BX-RETRY-001");
    await dialog.getByRole("spinbutton", { name: "金额（元）" }).fill("20");
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1180, height: 820 },
      { width: 760, height: 900 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      const fields = dialog.locator(".workflow-reimbursement-fields");
      await fields.scrollIntoViewIfNeeded();
      for (const selector of [
        ".ant-select",
        "input.ant-input",
        ".ant-input-number",
        ".workflow-reimbursement-remove",
      ]) {
        const control = fields.locator(selector).first();
        await expect(control).toHaveCSS("height", "32px");
        const box = await control.boundingBox();
        if (!box) throw new Error(`控件未显示: ${selector}`);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      }
      const path = testInfo.outputPath(`workflow-form-${viewport.width}.png`);
      await page.screenshot({ path, animations: "disabled" });
      await testInfo.attach(`workflow-form-${viewport.width}`, { path, contentType: "image/png" });
    }
    const submit = dialog.getByRole("button", { name: recording ? "保存补录" : "登记并归档" });
    await submit.click();
    await expect.poll(() => writes).toBe(1);
    await expect(submit).toHaveClass(/ant-btn-loading/);
    await formNo.press("Enter");
    expect(writes).toBe(1);
    await pending?.fulfill({ status: 403, json: { error: "测试写入失败，请重试" } });
    await expect(dialog.getByRole("alert")).toContainText("测试写入失败，请重试");
    await expect(formNo).toHaveValue("BX-RETRY-001");
    await submit.click();
    await expect.poll(() => writes).toBe(2);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await openForm();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await pending?.fulfill({ json: { ok: true, item: workflow } });
    await expect(dialog).toBeVisible();
    if (recording) await expect(dialog.getByRole("textbox", { name: /报销单号/ })).not.toHaveValue("BX-RETRY-001");
    else await expect(dialog.getByRole("switch", { name: "饲养费结算单", exact: true })).not.toBeChecked();
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
});

test("failed settlement list has a retry instead of an empty table", async ({ page }) => {
  let recovered = false;
  await page.route("**/api/billing-settlement-candidates?*", (route) =>
    route.fulfill(recovered ? { json: list } : { status: 403, json: { error: "暂时无法读取结算资料" } }),
  );
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /结算管理/ }).click();
  const error = page.getByRole("alert").filter({ hasText: "结算列表加载失败：暂时无法读取结算资料" });
  await expect(error).toBeVisible();
  await expect(page.getByText("暂无数据", { exact: true })).toHaveCount(0);
  recovered = true;
  await error.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("checkbox", { name: "选择 甲 2026-08 结算项", exact: true })).toBeVisible();
  await expect(error).toHaveCount(0);
});

test("manual selection wins over a slow select-all response", async ({ page }) => {
  let pending: Route | undefined;
  await page.route("**/api/billing-settlement-candidates?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("limit") === "100") pending = route;
    else await route.fulfill({ json: list });
  });
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /结算管理/ }).click();
  const all = page.getByRole("checkbox", { name: "全选当前筛选结果结算项", exact: true });
  await all.check();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.getByRole("checkbox", { name: "选择 甲 2026-08 结算项", exact: true }).check();
  await pending?.fulfill({ json: list });
  await expect(page.getByLabel("结算批量操作")).toContainText("已选 1 项");
  await expect(all).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "选择 乙 2026-08 结算项", exact: true })).not.toBeChecked();
});

test("workflow details open immediately, ignore closed requests, and retry access errors", async ({
  page,
}, testInfo) => {
  await page.route("**/api/billing-workflows?*", (route) =>
    route.fulfill({ json: { items: workflows, page: list.page } }),
  );
  const requests = new Map<string, Route>();
  await page.route("**/api/billing-workflows/workflow-*", (route) => {
    requests.set(new URL(route.request().url()).pathname.split("/").at(-1) || "", route);
  });
  await openWorkflowCenter(page);
  const first = page.getByRole("row").filter({ hasText: "甲" }).getByRole("button", { name: "查看", exact: true });
  const second = page.getByRole("row").filter({ hasText: "乙" }).getByRole("button", { name: "查看", exact: true });
  await first.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("status", { name: /流程详情/ })).toBeVisible();
  await expect.poll(() => requests.has(workflows[0].id)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(first).toBeFocused();
  await second.click();
  await expect.poll(() => requests.has(workflows[1].id)).toBe(true);
  await requests
    .get(workflows[0].id)
    ?.fulfill({ json: { workflow: { ...workflows[0], manager: "不应出现的旧详情" }, events: [], versions: [] } });
  await requests.get(workflows[1].id)?.fulfill({ status: 403, json: { error: "详情读取失败，请重试" } });
  await expect(dialog).toContainText("流程详情加载失败：详情读取失败，请重试");
  await expect(dialog).not.toContainText("不应出现的旧详情");
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1180, height: 820 },
    { width: 760, height: 900 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "重试" })).toHaveCSS("height", "32px");
    const bounds = await dialog.boundingBox();
    if (!bounds) throw new Error("流程详情弹窗未显示");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    const path = testInfo.outputPath(`workflow-detail-error-${viewport.width}.png`);
    await page.screenshot({ path, animations: "disabled" });
    await testInfo.attach(`workflow-detail-error-${viewport.width}`, { path, contentType: "image/png" });
  }
  requests.delete(workflows[1].id);
  await dialog.getByRole("button", { name: "重试" }).click();
  await expect.poll(() => requests.has(workflows[1].id)).toBe(true);
  await requests
    .get(workflows[1].id)
    ?.fulfill({ json: { workflow: { ...workflows[1], manager: "当前详情登记人" }, events: [], versions: [] } });
  await expect(dialog).toContainText("当前详情登记人");
  await expect(dialog).not.toContainText("加载失败");
});
