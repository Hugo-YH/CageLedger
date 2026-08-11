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
  await previewDialog.locator(".ant-modal-close").click();

  const batchRow = page.getByRole("row", { name: /E2E 批量负责人/ });
  await batchRow.getByRole("checkbox", { name: `选择 E2E 批量负责人 ${month} 结算项` }).check();
  await page.getByLabel("结算批量操作").getByRole("button", { name: "批量发起结算", exact: true }).click();
  const confirmDialog = page.getByRole("dialog", { name: "批量发起结算流程", exact: true });
  await expect(confirmDialog).toContainText("2 个项目负责人结算项");
  await confirmDialog.getByRole("button", { name: "发起 2 个流程", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已发起 2 个结算流程" })).toBeVisible();
});

test("settlement list shows 结算状态 column and filters by initiated workflow", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  for (const [index, id] of sheetIds.entries()) {
    const pi = index === 0 ? "E2E 已发起负责人" : "E2E 未发起负责人";
    await page.request.post("/api/quantity-sheets", {
      data: {
        sheet: {
          id,
          month,
          roomId: "room-e2e-8014",
          roomName: "8014",
          manager: "系统管理员",
          iacuc: `E2E-WF-00${index + 1}`,
          project: `结算状态项目 ${index + 1}`,
          pi,
          owner: "E2E 实验负责人",
          funding: `E2E-FUND-${index + 1}`,
          billingUnit: "cage_day",
          animalDetailEnabled: false,
          initialAnimalCount: 0,
          initialCageCount: 5,
          pageCount: 1,
          rows: [{ id: `${id}-row-1`, date: `${month}-01`, cageCount: 5 }],
        },
      },
    });
  }
  const generated = await page.request.post("/api/billing-statements/generate-by-pi", {
    data: { pi: "E2E 已发起负责人", month, sourceType: "quantity_sheet", status: "draft", persist: true },
  });
  expect(generated.ok()).toBeTruthy();

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /按项目负责人结算/ }).click();
  await expect(page.getByRole("heading", { name: "项目负责人结算", exact: true })).toBeVisible();

  await expect(page.getByRole("row", { name: /E2E 已发起负责人/ })).toContainText("已发起");
  await expect(page.getByRole("row", { name: /E2E 未发起负责人/ })).toContainText("未发起");

  // 已发起项的预览弹窗中，"发起结算流程"按钮应禁用并改文案
  await page
    .getByRole("row", { name: /E2E 已发起负责人/ })
    .getByRole("button", { name: "预览结算单" })
    .click();
  const initiatedButton = page.getByRole("button", { name: "已发起结算流程" });
  await expect(initiatedButton).toBeVisible({ timeout: 10_000 });
  await expect(initiatedButton).toBeDisabled();
  // 操作按钮位于弹窗顶部工具栏，预览 iframe 独立滚动；关闭走右上角 X
  await expect(page.locator(".settlement-preview-modal .settlement-preview-toolbar")).toBeVisible();
  await expect(page.locator(".settlement-preview-modal iframe[title='结算单预览']")).toBeVisible();
  await page.locator(".settlement-preview-modal .ant-modal-close").click();
  await expect(initiatedButton).toHaveCount(0);

  await page.getByRole("button", { name: "筛选结算状态", exact: true }).click();
  const filterPanel = page.locator(".table-filter-panel:visible");
  await expect(filterPanel).toBeVisible();
  const initiatedLabel = filterPanel.locator("label").filter({ hasText: /已发起/ });
  await expect(initiatedLabel).toBeVisible({ timeout: 10_000 });
  await initiatedLabel.click();
  await filterPanel.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByRole("row", { name: /E2E 已发起负责人/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /E2E 未发起负责人/ })).toHaveCount(0);

  // 清空筛选后撤回已发起的流程，行回到"未发起"
  await page.getByRole("button", { name: "筛选结算状态", exact: true }).click();
  await page.locator(".table-filter-panel:visible").getByRole("button", { name: "清空", exact: true }).click();
  await page.locator(".table-filter-panel:visible").getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByRole("row", { name: /E2E 未发起负责人/ })).toBeVisible();
  await page
    .getByRole("row", { name: /E2E 已发起负责人/ })
    .getByRole("button", { name: "撤回" })
    .click();
  await page.locator(".ant-popconfirm").getByRole("button", { name: "撤回", exact: true }).click();
  await expect(page.getByRole("row", { name: /E2E 已发起负责人/ })).toContainText("未发起", { timeout: 10_000 });
  await expect(page.getByRole("row", { name: /E2E 已发起负责人/ }).getByRole("button", { name: "撤回" })).toHaveCount(
    0,
  );
});

const overflowSheetIds = Array.from({ length: 12 }, (_, i) => `sheet-e2e-overflow-${i + 1}`);

test.afterEach(async ({ page }) => {
  for (const id of overflowSheetIds) await page.request.delete(`/api/quantity-sheets/${id}`);
});

test("settlement preview toolbar keeps long IACUC lists inside the toolbar", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  for (const [index, id] of overflowSheetIds.entries()) {
    await page.request.post("/api/quantity-sheets", {
      data: {
        sheet: {
          id,
          month,
          roomId: "room-e2e-8014",
          roomName: "8014",
          manager: "系统管理员",
          iacuc: `E2E-OVERFLOW-${String(index + 1).padStart(3, "0")}`,
          project: `溢出项目 ${index + 1}`,
          pi: "E2E 多伦理号负责人",
          owner: "E2E 实验负责人",
          funding: `E2E-FUND-${index + 1}`,
          billingUnit: "cage_day",
          animalDetailEnabled: false,
          initialAnimalCount: 0,
          initialCageCount: 5,
          pageCount: 1,
          rows: [{ id: `${id}-row-1`, date: `${month}-01`, cageCount: 5 }],
        },
      },
    });
  }

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /按项目负责人结算/ }).click();
  await expect(page.getByRole("heading", { name: "项目负责人结算", exact: true })).toBeVisible();
  await page
    .getByRole("row", { name: /E2E 多伦理号负责人/ })
    .getByRole("button", { name: "预览结算单" })
    .click();
  await expect(page.locator(".settlement-preview-modal").getByRole("button", { name: "发起结算流程" })).toBeVisible({
    timeout: 20_000,
  });

  const overflow = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>(".settlement-preview-modal .settlement-preview-toolbar");
    const modalBody = document.querySelector<HTMLElement>(".settlement-preview-modal .ant-modal-body");
    const context = document.querySelector<HTMLElement>(
      ".settlement-preview-modal .settlement-preview-toolbar-context",
    );
    if (!toolbar || !modalBody || !context) return { missing: true };
    const toolbarRect = toolbar.getBoundingClientRect();
    const bodyRect = modalBody.getBoundingClientRect();
    return {
      missing: false,
      toolbarOverflowsModal: toolbarRect.right > bodyRect.right + 1 || toolbarRect.left < bodyRect.left - 1,
      contextTruncated: context.scrollWidth > context.clientWidth,
    };
  });
  expect(overflow.missing).toBe(false);
  expect(overflow.toolbarOverflowsModal).toBe(false);
  expect(overflow.contextTruncated).toBe(true);
});

const noticeSheetId = "sheet-e2e-notice";

test.afterEach(async ({ page }) => {
  await page.request.delete(`/api/quantity-sheets/${noticeSheetId}`).catch(() => {});
});

test("发起结算流程 generates the notification email template", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  await page.request.post("/api/quantity-sheets", {
    data: {
      sheet: {
        id: noticeSheetId,
        month,
        roomId: "room-e2e-8014",
        roomName: "8014",
        manager: "系统管理员",
        iacuc: "E2E-NOTICE-001",
        project: "邮件通知项目",
        pi: "E2E 邮件通知负责人",
        owner: "E2E 实验负责人",
        funding: "E2E-FUND-NOTICE",
        billingUnit: "cage_day",
        animalDetailEnabled: false,
        initialAnimalCount: 0,
        initialCageCount: 5,
        pageCount: 1,
        rows: [{ id: `${noticeSheetId}-row-1`, date: `${month}-01`, cageCount: 5 }],
      },
    },
  });

  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /按项目负责人结算/ }).click();
  await expect(page.getByRole("heading", { name: "项目负责人结算", exact: true })).toBeVisible();
  const noticeRow = page.getByRole("row", { name: /E2E 邮件通知负责人/ });
  await expect(noticeRow).toBeVisible();
  // 重试场景：上一次运行留下的流程先撤回，回到未发起
  if ((await noticeRow.innerText()).includes("已发起")) {
    await noticeRow.getByRole("button", { name: "撤回" }).click();
    await page.locator(".ant-popconfirm").getByRole("button", { name: "撤回", exact: true }).click();
    await expect(noticeRow).toContainText("未发起");
  }
  await noticeRow.getByRole("button", { name: "预览结算单" }).click();
  await expect(page.locator(".settlement-preview-modal").getByRole("button", { name: "发起结算流程" })).toBeVisible({
    timeout: 20_000,
  });
  await page.locator(".settlement-preview-modal").getByRole("button", { name: "发起结算流程" }).click();

  const noticeModal = page.locator(".settlement-notice-modal");
  const noticeBody = noticeModal.locator(".settlement-notice-body");
  await expect(noticeBody).toBeVisible({ timeout: 10_000 });
  await expect(noticeModal.locator(".settlement-notice-head")).toBeVisible();
  await expect(noticeModal.locator(".ant-modal-title")).toContainText("实验动物饲养费结算的通知");
  // 无底部 footer（取消/确认），关闭仅右上角 X
  await expect(noticeModal.locator(".ant-modal-footer")).toHaveCount(0);
  // "复制并确认"按钮不与右上角关闭 X 重叠
  const overlap = await page.evaluate(() => {
    const modal = document.querySelector<HTMLElement>(".settlement-notice-modal");
    const button = modal?.querySelector<HTMLElement>(".settlement-notice-head .ant-btn");
    const close = modal?.querySelector<HTMLElement>(".ant-modal-close");
    if (!modal || !button || !close) return { missing: true };
    const b = button.getBoundingClientRect();
    const c = close.getBoundingClientRect();
    return { missing: false, buttonRight: Math.round(b.right), closeLeft: Math.round(c.left) };
  });
  expect(overlap.missing).toBe(false);
  if (overlap.missing) throw new Error("未找到按钮或关闭 X");
  expect(overlap.buttonRight!).toBeLessThanOrEqual(overlap.closeLeft!);
  const subject = await noticeModal.locator(".settlement-notice-subject").innerText();
  const body = await noticeBody.innerText();
  expect(body).toContain("应交总额为");
  expect(body).toContain("材料接收点：珠江新城办公室8009");
  expect(body).toContain("系统管理员");

  // 复制并确认：复制邮件内容并发起结算流程
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await noticeModal.getByRole("button", { name: "复制并确认" }).click();
  await expect(noticeModal).toHaveCount(0, { timeout: 10_000 });
  await expect(noticeRow).toContainText("已发起", { timeout: 10_000 });
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe(`${subject}\n\n${body}`);
  await page.locator(".settlement-preview-modal .ant-modal-close").click();

  // 内网 HTTP（非安全上下文）没有 Clipboard API：撤回流程后模拟该环境，
  // 验证回退复制路径仍然把邮件内容写入剪贴板。
  await noticeRow.getByRole("button", { name: "撤回" }).click();
  await page.locator(".ant-popconfirm").getByRole("button", { name: "撤回", exact: true }).click();
  await expect(noticeRow).toContainText("未发起");
  await page.addInitScript(() => {
    const clipboard = navigator.clipboard;
    Object.defineProperty(window, "__clipboardRead", {
      configurable: true,
      value: () => clipboard?.readText(),
    });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });
  await page.reload();
  await openBillingNavigation(page);
  await page.getByRole("menuitem", { name: /按项目负责人结算/ }).click();
  await expect(page.getByRole("heading", { name: "项目负责人结算", exact: true })).toBeVisible();
  const fallbackRow = page.getByRole("row", { name: /E2E 邮件通知负责人/ });
  await expect(fallbackRow).toBeVisible();
  await fallbackRow.getByRole("button", { name: "预览结算单" }).click();
  await expect(page.locator(".settlement-preview-modal").getByRole("button", { name: "发起结算流程" })).toBeVisible({
    timeout: 20_000,
  });
  await page.locator(".settlement-preview-modal").getByRole("button", { name: "发起结算流程" }).click();
  const fallbackModal = page.locator(".settlement-notice-modal");
  await expect(fallbackModal.locator(".settlement-notice-body")).toBeVisible({ timeout: 10_000 });
  const fallbackSubject = await fallbackModal.locator(".settlement-notice-subject").innerText();
  const fallbackBody = await fallbackModal.locator(".settlement-notice-body").innerText();
  await fallbackModal.getByRole("button", { name: "复制并确认" }).click();
  await expect(fallbackModal).toHaveCount(0, { timeout: 10_000 });
  await expect(fallbackRow).toContainText("已发起", { timeout: 10_000 });
  const fallbackClipboard = await page.evaluate(() =>
    (window as unknown as { __clipboardRead?: () => Promise<string> }).__clipboardRead?.(),
  );
  expect(fallbackClipboard).toBe(`${fallbackSubject}\n\n${fallbackBody}`);
});
