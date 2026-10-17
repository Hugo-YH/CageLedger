import type { BillingWorkflow } from "../../src/react/api/workflows";
import { expect, openNavigationEntry, test } from "./fixtures";

test("billing lists preserve established fee, lock and document colors across themes", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  const response = await page.request.get("/api/billing-workflows?limit=10&offset=0");
  expect(response.ok(), await response.text()).toBeTruthy();
  const base = ((await response.json()) as { items: BillingWorkflow[] }).items[0];
  expect(base).toBeTruthy();
  const items = [
    {
      id: "tag-paid",
      pi: "配色全额",
      sourceType: "quantity_sheet",
      workflowStatus: "statement_locked",
      receivedAmount: 100,
    },
    {
      id: "tag-partial",
      pi: "配色部分缴费",
      sourceType: "pi_merged_technical_service",
      workflowStatus: "statement_archived",
      receivedAmount: 50,
    },
    {
      id: "tag-unreturned",
      pi: "配色未交回",
      sourceType: "quantity_sheet",
      workflowStatus: "statement_archived",
      receivedAmount: 0,
      signedStatementReturned: false,
      reimbursementFormReturned: false,
    },
    {
      id: "tag-sent",
      pi: "配色已发起",
      sourceType: "pi_merged_technical_service",
      workflowStatus: "statement_sent",
      receivedAmount: 0,
    },
  ].map((row) => ({
    ...base,
    month: "2027-01",
    totalAmount: 100,
    reimbursementRequired: true,
    signedStatementReturned: true,
    reimbursementFormReturned: true,
    ...row,
  }));
  await page.route("**/api/billing-workflows?*", (route) =>
    route.fulfill({ json: { items, page: { total: items.length, limit: 10, offset: 0 } } }),
  );
  await page.route("**/api/settlement-candidates?*", (route) =>
    route.fulfill({
      json: {
        items: items.map((row) => ({
          ...row,
          feeType: row.sourceType === "pi_merged_technical_service" ? "technical_service" : "feeding",
          hasWorkflow: true,
        })),
        page: { total: items.length, limit: 10, offset: 0 },
      },
    }),
  );
  await openNavigationEntry(page, "结算管理", "结算列表");
  const paidCandidate = page.getByRole("row").filter({ hasText: "配色全额" });
  await expect(paidCandidate.getByText("饲养费", { exact: true })).toHaveClass(/ant-tag-green/);
  await expect(paidCandidate.getByText("已归档", { exact: true })).toHaveClass(/ant-tag-purple/);
  await expect(
    page.getByRole("row").filter({ hasText: "配色部分缴费" }).getByText("技术服务费", { exact: true }),
  ).toHaveClass(/ant-tag-magenta/);

  await openNavigationEntry(page, "结算管理", "单据跟踪");
  const paid = page.getByRole("row").filter({ hasText: "配色全额" });
  const partial = page.getByRole("row").filter({ hasText: "配色部分缴费" });
  const unreturned = page.getByRole("row").filter({ hasText: "配色未交回" });
  const palette: unknown[] = [];
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(paid.getByText("已归档", { exact: true })).toHaveClass(/ant-tag-purple/);
    await expect(paid.getByText("结算单 已交回", { exact: true })).toHaveClass(/ant-tag-blue/);
    await expect(paid.getByText("报销单 已交回", { exact: true })).toHaveClass(/ant-tag-green/);
    await expect(partial.getByText("报销单 已交回（未全额缴费）", { exact: true })).toHaveClass(/ant-tag-orange/);
    await expect(unreturned.getByText("结算单 未交回", { exact: true })).toHaveClass(/ant-tag-default/);
    await expect(unreturned.getByText("报销单 未交回", { exact: true })).toHaveClass(/ant-tag-default/);
    for (const width of [1440, 860]) {
      await page.setViewportSize({ width, height: width === 860 ? 642 : 900 });
      const colors = await paid.locator(".ant-tag").evaluateAll((tags) =>
        tags.map((tag) => ({
          text: tag.textContent,
          color: getComputedStyle(tag).color,
          background: getComputedStyle(tag).backgroundColor,
        })),
      );
      palette.push({ theme, width, colors });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
      await paid.getByText("结算单 已交回", { exact: true }).scrollIntoViewIfNeeded();
      await info.attach(`workflow-tags-${theme}-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/billing-workflows/tag-paid", (route) =>
    route.fulfill({
      json: {
        workflow: { ...items[0], attachments: [], reimbursementForms: [] },
        events: [
          {
            id: "tag-registration",
            eventType: "statement_registered_archived",
            at: "2027-01-02T10:00:00Z",
            actor: { id: "tag-actor", username: "tag-actor", displayName: "配色验证" },
            note: "",
          },
        ],
      },
    }),
  );
  await paid.getByRole("button", { name: "查看", exact: true }).click();
  const detail = page.getByRole("dialog", { name: /结算流程详情/ });
  await expect(detail.getByText("结算单 已交回", { exact: true })).toHaveClass(/ant-tag-blue/);
  await expect(detail.getByText("报销单 已交回", { exact: true })).toHaveClass(/ant-tag-green/);
  await expect(detail.getByRole("heading", { name: "流转记录", exact: true })).toHaveCount(1);
  for (const width of [1440, 860]) {
    await page.setViewportSize({ width, height: width === 860 ? 642 : 900 });
    const sectionGap = await detail.evaluate((element) => {
      const overview = element.querySelector(".workflow-detail-overview")!;
      const records = element.querySelector('[aria-label="流转记录"]')!;
      return records.getBoundingClientRect().top - overview.getBoundingClientRect().bottom;
    });
    expect(sectionGap).toBe(24);
    await info.attach(`workflow-detail-spacing-${width}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await detail.locator(".ant-modal-close").click();
  await page.route("**/api/billing-workflows/tag-sent/funding-options", (route) =>
    route.fulfill({ json: { items: [], iacucs: [], piFundingBookNos: [], piFundingBookOptions: [] } }),
  );
  await page
    .getByRole("row")
    .filter({ hasText: "配色已发起" })
    .getByRole("button", { name: "登记", exact: true })
    .click();
  const registration = page.getByRole("dialog", { name: /交回登记/ });
  const statementSwitch = page.getByRole("switch", { name: "技术服务费结算单", exact: true });
  const reimbursementSwitch = page.getByRole("switch", { name: "报销单", exact: true });
  await expect(
    registration.locator(".ant-form-item").filter({ has: statementSwitch }).getByText("已交回", { exact: true }),
  ).toHaveClass(/ant-tag-blue/);
  await expect(
    registration.locator(".ant-form-item").filter({ has: reimbursementSwitch }).getByText("已交回", { exact: true }),
  ).toHaveClass(/ant-tag-green/);
  await registration.locator(".ant-modal-close").click();
  await info.attach("tag-palette", { body: Buffer.from(JSON.stringify(palette)), contentType: "application/json" });
});
