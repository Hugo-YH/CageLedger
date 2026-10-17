import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  ensureTestInfrastructure,
  expect,
  openNavigationEntry,
  openWorkflowCenter,
  selectAntOptionByKeyboard,
  test,
} from "./fixtures";

async function loginAndSeed(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  const csv =
    "动物伦理编号,动物实验名称,项目负责人,实验负责人,项目来源\nZ2099001,技术服务验收项目（长名称布局验证）技术服务验收项目（长名称布局验证）技术服务验收项目（长名称布局验证）,技术服务验收负责人,验收实验负责人,验收经费\nZ2099002,服务分页项目,分页负责人,验收实验负责人,分页经费\nZ2099003,服务删除项目,删除负责人,验收实验负责人,删除经费\n";
  const upload = await page.request.post("/api/iacuc-index/upload", {
    multipart: { file: { name: "services.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
}

async function filterServiceColumn(page: Page, label: string, values: string[]) {
  const alternative =
    ({ 月份: "结算月份", 伦理号: "IACUC", 流程: "结算状态" } as Record<string, string>)[label] || label;
  await expect
    .poll(
      async () =>
        (await page.getByRole("button", { name: `筛选${label}`, exact: true }).count()) +
        (await page.getByRole("button", { name: `筛选${alternative}`, exact: true }).count()),
    )
    .toBeGreaterThan(0);
  if ((await page.getByRole("button", { name: `筛选${label}`, exact: true }).count()) === 0)
    label = ({ 月份: "结算月份", 伦理号: "IACUC", 流程: "结算状态" } as Record<string, string>)[label] || label;
  await page.getByRole("button", { name: `筛选${label}`, exact: true }).click();
  const panel = page.getByRole("group", { name: `筛选${label}选项`, exact: true });
  await panel.getByRole("button", { name: "清空", exact: true }).click();
  for (const value of values) {
    const checkbox = panel.getByRole("checkbox", { name: value, exact: false });
    await checkbox.click();
    await expect(checkbox).toBeChecked();
  }
  await panel.getByRole("button", { name: "应用", exact: true }).click();
  await expect(panel).toBeHidden();
}

test("technical service UI saves 4 days / 10 eyes / 300 yuan and shares workflow", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await loginAndSeed(page);
  await openNavigationEntry(page, "技术服务费管理", "录入技术服务明细");
  await expect(page.getByRole("heading", { name: "录入技术服务明细", exact: true })).toBeVisible();
  await page.locator("#service-month").fill("2026-10");
  await page.locator("#service-iacuc").fill("Z2099001");
  await page.locator("#service-iacuc").blur();
  await expect(page.getByRole("region", { name: "IACUC项目信息", exact: true })).toContainText("技术服务验收负责人");
  await page.locator("#service-item").click();
  await page.locator("#service-item").fill("大动物滴眼");
  await page.getByText("大动物滴眼", { exact: true }).click();
  for (const [index, [day, quantity]] of [
    [1, 2],
    [2, 2],
    [3, 4],
    [10, 2],
  ].entries()) {
    if (index) await page.getByRole("button", { name: "添加服务日期" }).click();
    await page.getByLabel(`服务日期 ${index + 1}`, { exact: true }).fill(`2026-10-${String(day).padStart(2, "0")}`);
    await page.getByLabel(`服务日期 ${index + 1}`, { exact: true }).press("Enter");
    await page.getByLabel(`计费数量 ${index + 1}`, { exact: true }).fill(String(quantity));
  }
  const totals = page.getByRole("region", { name: "技术服务费用核对", exact: true });
  await expect(totals).toContainText("4个服务日");
  await expect(totals).toContainText("10眼");
  await expect(totals).toContainText("300.00元");
  for (const [width, height] of [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator("#service-item")).toBeVisible();
    if (width < 768 || height <= 480) {
      await expect(page.locator("#service-iacuc")).toHaveCSS("font-size", "16px");
      expect(
        await page.locator("#service-iacuc").evaluate((el) => el.getBoundingClientRect().height),
      ).toBeGreaterThanOrEqual(40);
      expect(
        await page
          .getByRole("button", { name: "保存技术服务明细", exact: true })
          .evaluate((el) => el.getBoundingClientRect().height),
      ).toBeGreaterThanOrEqual(44);
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    await testInfo.attach(`service-entry-${width}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await testInfo.attach(`service-layout-${width}`, {
      body: Buffer.from(
        JSON.stringify(
          await page
            .locator(".technical-service-fields")
            .first()
            .evaluate((el) => ({
              columns: getComputedStyle(el).gridTemplateColumns,
              width: el.getBoundingClientRect().width,
            })),
        ),
      ),
      contentType: "application/json",
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const accessibility = await new AxeBuilder({ page }).include(".technical-service-layout").analyze();
  expect(accessibility.violations.filter((v) => ["serious", "critical"].includes(v.impact || ""))).toEqual([]);
  let releaseSave: (() => void) | undefined;
  let sawSave: (() => void) | undefined;
  const saveBlocked = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const saveStarted = new Promise<void>((resolve) => {
    sawSave = resolve;
  });
  await page.route(
    "**/api/technical-services/sheets",
    async (route) => {
      sawSave?.();
      await saveBlocked;
      await route.fulfill({ status: 503, json: { error: "服务暂时不可用，请重试" } });
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "保存技术服务明细", exact: true }).click();
  await saveStarted;
  await expect(page.getByRole("button", { name: "添加服务日期" })).toBeDisabled();
  await expect(page.getByLabel("计费数量 1", { exact: true })).toBeDisabled();
  await testInfo.attach("service-save-loading", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  releaseSave?.();
  await expect(page.getByText("服务暂时不可用，请重试", { exact: true })).toBeVisible();
  await expect(page.getByLabel("计费数量 3", { exact: true })).toHaveValue("4");
  await testInfo.attach("service-save-error", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "保存技术服务明细", exact: true }).click();
  await expect(page.getByText("技术服务明细已保存", { exact: true })).toBeVisible();
  await openNavigationEntry(page, "技术服务费管理", "已保存技术服务明细");
  await filterServiceColumn(page, "月份", ["2026-10"]);
  const row = page.getByRole("row").filter({ hasText: "Z2099001" });
  await expect(row).toContainText("300.00");
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("计费数量（眼）");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await openNavigationEntry(page, "结算管理", "结算列表");
  await filterServiceColumn(page, "月份", ["2026-10"]);
  await page
    .getByRole("row")
    .filter({ hasText: "技术服务验收负责人" })
    .getByRole("button", { name: "预览结算单" })
    .click();
  await expect(page.frameLocator('iframe[title="结算单预览"]').getByText("服务日数：4 合计：300.00 元")).toBeVisible();
  await page
    .getByRole("dialog", { name: /技术服务验收负责人/ })
    .getByRole("button", { name: "发起结算流程", exact: true })
    .click();
  await expect(page.getByLabel("邮件正文")).toContainText("300.00元");
  await page.getByRole("button", { name: "复制并确认", exact: true }).click();
  await expect(page.getByRole("button", { name: "已发起结算流程", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(
    page.frameLocator('iframe[title="结算单预览"]').getByText("服务日数：4 合计：300.00 元"),
  ).not.toBeVisible();
  const list = await page.request.get(
    "/api/billing-workflows?limit=100&offset=0&sourceType=pi_merged_technical_service",
  );
  const workflow = (await list.json()).items.find((item: { pi: string }) => item.pi === "技术服务验收负责人");
  expect(workflow.totalAmount).toBe(300);
  expect(workflow.sourceType).toBe("pi_merged_technical_service");
  await openWorkflowCenter(page);
  await expect(page.getByRole("row").filter({ hasText: "技术服务验收负责人" })).toContainText("技术服务费");
  await selectAntOptionByKeyboard(page, page.getByRole("combobox", { name: "费用类型" }), 2);
  await openNavigationEntry(page, "技术服务费管理", "已保存技术服务明细");
  await filterServiceColumn(page, "月份", ["2026-10"]);
  await page
    .getByRole("row")
    .filter({ hasText: "Z2099001" })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await expect(page.getByLabel("计费数量 1", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await openWorkflowCenter(page);
  await expect(
    page.locator(".ledger-section .ant-select").filter({ has: page.getByRole("combobox", { name: "费用类型" }) }),
  ).toContainText("技术服务费");

  const exported = await page.request.post("/api/billing-monthly-summary/export", { data: { month: "2026-10" } });
  expect(exported.ok(), await exported.text()).toBeTruthy();
  expect(exported.headers()["content-type"]).toContain("spreadsheetml");
  await testInfo.attach("service-monthly-summary", {
    body: await exported.body(),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
});

test("service HTTP validates versions, hourly quantity, delete replay and produces multi-page PDF", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await loginAndSeed(page);
  const sheet = {
    id: "service-pdf-probe",
    month: "2026-10",
    iacuc: "Z2099002",
    facility: "bioisland",
    serviceId: "large_eye_drops",
    customerType: "internal",
    rows: Array.from({ length: 25 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, quantity: 1 })),
  };
  const save = await page.request.post("/api/technical-services/sheets", { data: { sheet } });
  expect(save.ok(), await save.text()).toBeTruthy();
  const replay = await page.request.post("/api/technical-services/sheets", { data: { sheet } });
  expect((await replay.json()).item.updatedAt).toBe((await save.json()).item.updatedAt);
  const conflict = await page.request.put(`/api/technical-services/sheets/${sheet.id}`, {
    data: { sheet, expectedUpdatedAt: "stale" },
  });
  expect(conflict.status()).toBe(409);
  const pdf = await page.request.post("/api/technical-services/settlements/pdf", {
    data: { month: "2026-10", pi: "分页负责人" },
  });
  expect(pdf.ok(), await pdf.text()).toBeTruthy();
  const body = await pdf.body();
  expect(body.subarray(0, 4).toString()).toBe("%PDF");
  const pdfPath = testInfo.outputPath("service-physical-pages.pdf");
  writeFileSync(pdfPath, body);
  execFileSync(
    process.execPath,
    [
      "scripts/run_python.mjs",
      "-c",
      "import re,sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1]); assert len(r.pages)==2; assert all('750.00' in p.extract_text() for p in r.pages); assert all(re.search(str(i+1)+r'\\s*/\\s*2',p.extract_text()) for i,p in enumerate(r.pages)); assert all(abs(float(p.mediabox.width)-595)<1 and abs(float(p.mediabox.height)-842)<1 for p in r.pages)",
      pdfPath,
    ],
    { stdio: "pipe" },
  );

  await testInfo.attach("service-multipage.pdf", { body, contentType: "application/pdf" });
  const hourly = {
    ...sheet,
    id: "hourly-probe",
    iacuc: "Z2099003",
    serviceId: "veterinary_observation",
    rows: [{ date: "2026-10-01", quantity: 0.5 }],
  };
  expect((await page.request.post("/api/technical-services/sheets", { data: { sheet: hourly } })).status()).toBe(400);
  hourly.rows[0].quantity = 1.5;
  const saved = await page.request.post("/api/technical-services/sheets", { data: { sheet: hourly } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const item = (await saved.json()).item;
  expect(item.totalAmount).toBe(300);
  expect(
    (
      await page.request.delete(`/api/technical-services/sheets/${item.id}`, {
        data: { expectedUpdatedAt: item.updatedAt },
      })
    ).ok(),
  ).toBeTruthy();
  expect((await page.request.post("/api/technical-services/sheets", { data: { sheet: hourly } })).status()).toBe(409);
  expect((await page.request.get(`/api/technical-services/sheets/${item.id}`)).status()).toBe(404);
});

test("technical service registration, lock and withdrawal use real account permissions", async ({
  page,
  playwright,
}) => {
  await loginAndSeed(page);
  for (const username of ["tech-owner", "tech-other"]) {
    const response = await page.request.post("/api/users", {
      data: { username, displayName: "同名技术人员", password: "e2e-password", role: "room_admin", roomIds: [] },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  const owner = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  const other = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    for (const [context, username] of [
      [owner, "tech-owner"],
      [other, "tech-other"],
    ] as const) {
      expect(
        (await context.post("/api/auth/login", { data: { username, password: "e2e-password" } })).ok(),
      ).toBeTruthy();
    }
    const sheet = {
      id: "service-permission-probe",
      month: "2026-09",
      iacuc: "Z2099003",
      facility: "zhujiang",
      serviceId: "large_eye_drops",
      customerType: "internal",
      rows: [{ date: "2026-09-01", quantity: 10 }],
    };
    const created = await owner.post("/api/technical-services/sheets", { data: { sheet } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const preview = await owner.post("/api/technical-services/settlements/preview", {
      data: { month: sheet.month, pi: "删除负责人" },
    });
    const started = await page.request.post("/api/technical-services/settlements", {
      data: { month: sheet.month, pi: "删除负责人", sourceVersions: (await preview.json()).sourceVersions },
    });
    expect(started.ok(), await started.text()).toBeTruthy();
    const workflowId = (await started.json()).workflow.id;
    const rejected = await other.post("/api/billing-workflows/advance", {
      data: { workflowId, toStatus: "statement_generated", note: "越权撤回" },
    });
    expect(rejected.status()).toBe(403);
    const registered = await owner.post("/api/billing-workflows/advance", {
      data: {
        workflowId,
        toStatus: "statement_archived",
        registration: {
          signedStatementReturned: true,
          reimbursementFormReturned: true,
          reimbursementForms: [{ formNo: "TS-PERMISSION", fundingBookNo: "TEST", amount: 300 }],
        },
      },
    });
    expect(registered.ok(), await registered.text()).toBeTruthy();
    expect(
      (
        await owner.post("/api/billing-workflows/advance", { data: { workflowId, toStatus: "statement_locked" } })
      ).status(),
    ).toBe(403);
    const locked = await page.request.post("/api/billing-workflows/advance", {
      data: { workflowId, toStatus: "statement_locked" },
    });
    expect(locked.ok(), await locked.text()).toBeTruthy();
    expect(
      (
        await owner.post("/api/billing-workflows/advance", {
          data: { workflowId, toStatus: "statement_sent", note: "已锁定撤回" },
        })
      ).ok(),
    ).toBeFalsy();
    expect(
      (
        await page.request.post("/api/billing-workflows/advance", {
          data: { workflowId, toStatus: "statement_archived" },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await owner.post("/api/billing-workflows/advance", {
          data: { workflowId, toStatus: "statement_sent", note: "修正登记" },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await owner.post("/api/billing-workflows/advance", {
          data: { workflowId, toStatus: "statement_generated", note: "修正明细" },
        })
      ).ok(),
    ).toBeTruthy();
    const item = (await created.json()).item;
    expect(
      (
        await owner.put(`/api/technical-services/sheets/${sheet.id}`, {
          data: { sheet, expectedUpdatedAt: item.updatedAt },
        })
      ).ok(),
    ).toBeTruthy();
    const audit = await page.request.get("/api/audit-events?limit=100&offset=0&entityType=technical_service_sheet");
    expect(
      (await audit.json()).items.some((event: { action: string }) => event.action === "technical_service.updated"),
    ).toBeTruthy();
  } finally {
    await owner.dispose();
    await other.dispose();
  }
});

test("saved service details edit, protect unsaved changes and delete through UI", async ({ page }) => {
  await loginAndSeed(page);
  const sheet = {
    id: "service-ui-delete-probe",
    month: "2026-10",
    iacuc: "Z2099003",
    facility: "zhujiang",
    serviceId: "large_eye_drops",
    customerType: "internal",
    rows: [{ date: "2026-10-01", quantity: 2 }],
  };
  expect((await page.request.post("/api/technical-services/sheets", { data: { sheet } })).ok()).toBeTruthy();
  await openNavigationEntry(page, "技术服务费管理", "已保存技术服务明细");
  await filterServiceColumn(page, "月份", ["2026-10"]);
  const row = page.getByRole("row").filter({ hasText: "Z2099003" });
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("计费数量 1", { exact: true }).fill("3");
  await page.getByRole("button", { name: "保存技术服务明细", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "技术服务明细", exact: true })).toBeHidden();
  await expect(row).toContainText("90.00");
  await expect(page.getByRole("status").filter({ hasText: "技术服务明细已保存" })).toBeVisible();
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("计费数量 1", { exact: true }).fill("4");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByLabel("计费数量 1", { exact: true })).toHaveValue("4");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改并离开", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "技术服务明细", exact: true })).toBeHidden();
  await expect(row).toContainText("90.00");
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await page
    .getByRole("dialog", { name: "删除技术服务明细", exact: true })
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect((await page.request.get(`/api/technical-services/sheets/${sheet.id}`)).status()).toBe(404);
});

test("service pages use the billing workspace style across desktop and mobile layouts", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await loginAndSeed(page);
  const sheet = {
    id: "service-style-probe",
    month: "2026-10",
    iacuc: "Z2099002",
    facility: "zhujiang",
    serviceId: "large_eye_drops",
    customerType: "internal",
    rows: [{ date: "2026-10-01", quantity: 2 }],
  };
  expect((await page.request.post("/api/technical-services/sheets", { data: { sheet } })).ok()).toBeTruthy();
  await openNavigationEntry(page, "饲养费管理", "录入数量统计表");
  const billingToolbar = await page.locator(".quantity-entry-toolbar").evaluate((el) => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, radius: s.borderRadius, padding: s.padding };
  });
  for (const [width, height] of [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    for (const name of ["录入技术服务明细", "已保存技术服务明细", "结算列表"]) {
      await openNavigationEntry(page, name === "结算列表" ? "结算管理" : "技术服务费管理", name);
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
      await expect(page.locator(".ant-mobile-navigation-sheet")).toBeHidden();
      const workspace =
        name === "结算列表"
          ? page.locator('[data-feature="billing"]').first()
          : page.locator('[data-feature="technical-services"]');
      const toolbar = workspace.locator('[data-ui="workspace-toolbar"]').first();
      if (width === 1440) {
        expect(
          await toolbar.evaluate((el) => {
            const s = getComputedStyle(el);
            return { background: s.backgroundColor, radius: s.borderRadius, padding: s.padding };
          }),
        ).toEqual(billingToolbar);
      }
      if (name !== "录入技术服务明细") {
        await expect(workspace.locator('[data-ui="data-table"]')).toBeVisible();
        await expect(workspace.getByRole("navigation")).toBeVisible();
        const filterLabel = name === "结算列表" ? "结算月份" : "月份";
        const trigger = page.getByRole("button", { name: `筛选${filterLabel}`, exact: true });
        await trigger.focus();
        await page.keyboard.press("Enter");
        const panel = page.getByRole("group", { name: `筛选${filterLabel}选项`, exact: true });
        const popup = page.locator(".ant-popover").filter({ has: panel });
        await expect(popup).toHaveCSS("opacity", "1");
        await expect(panel.getByPlaceholder("搜索当前列")).toBeInViewport();
        const rect = await popup.evaluate((element) => element.getBoundingClientRect().toJSON());
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.top).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(width + 1);
        expect(rect.bottom).toBeLessThanOrEqual(height + 1);
        await testInfo.attach(`${name}-funnel-${width}`, { body: await page.screenshot(), contentType: "image/png" });
        await panel.getByRole("button", { name: "应用", exact: true }).click();
        await expect(panel).toBeHidden();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
      await testInfo.attach(`${name}-computed-${width}`, {
        body: Buffer.from(
          JSON.stringify(
            await workspace.evaluate((el) => ({
              width: el.getBoundingClientRect().width,
              minWidth: getComputedStyle(el).minWidth,
              display: getComputedStyle(el).display,
              fields: Array.from(el.querySelectorAll(".technical-service-fields")).map((field) => ({
                columns: getComputedStyle(field).gridTemplateColumns,
                width: field.getBoundingClientRect().width,
              })),
            })),
          ),
        ),
        contentType: "application/json",
      });
      await testInfo.attach(`${name}-${width}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNavigationEntry(page, "技术服务费管理", "已保存技术服务明细");
  await filterServiceColumn(page, "月份", [sheet.month]);
  const saved = page.getByRole("row").filter({ hasText: "Z2099002" }).filter({ hasText: "珠江新城" });
  await expect(saved.getByRole("button", { name: "预览", exact: true })).toHaveCSS("width", "64px");
  await saved.getByRole("button", { name: "预览", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "技术服务明细预览", exact: true });
  await expect(dialog).toContainText("60.00");
  await expect(dialog.getByRole("button", { name: "保存技术服务明细" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
});

test("service column funnels filter all pages, combine selections, clear and reset pagination", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await loginAndSeed(page);
  for (let index = 1; index <= 12; index++) {
    const month = `2025-${String(index).padStart(2, "0")}`;
    const sheet = {
      id: `service-filter-${index}`,
      month,
      iacuc: "Z2099003",
      facility: index % 2 ? "zhujiang" : "bioisland",
      serviceId: "large_eye_drops",
      customerType: "internal",
      rows: [{ date: `${month}-01`, quantity: index }],
    };
    expect((await page.request.post("/api/technical-services/sheets", { data: { sheet } })).ok()).toBeTruthy();
  }
  await openNavigationEntry(page, "技术服务费管理", "已保存技术服务明细");
  await expect(page.locator("#service-filter-month")).toHaveCount(0);
  await page.getByRole("button", { name: "right", exact: true }).click();
  await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
  await filterServiceColumn(page, "月份", ["2025-01", "2025-02"]);
  await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
  await expect(page.getByLabel("列表总数")).toHaveText("共 2 条");
  await expect(page.getByRole("button", { name: "筛选月份", exact: true })).toHaveAttribute("aria-pressed", "true");
  await filterServiceColumn(page, "服务设施", ["生物岛"]);
  await expect(page.getByLabel("列表总数")).toHaveText("共 1 条");
  await expect(page.getByRole("row").filter({ hasText: "Z2099003" })).toContainText("2025-02");
  await filterServiceColumn(page, "月份", []);
  await filterServiceColumn(page, "服务设施", []);
  await expect(page.getByRole("button", { name: "筛选月份", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("列表总数")).not.toHaveText("共 1 条");
  await page.getByRole("button", { name: "筛选月份", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "筛选月份选项", exact: true }).getByRole("checkbox", { name: /2025-01/ }),
  ).toBeVisible();
  await expect(
    page.locator(".ant-popover").filter({ has: page.getByRole("group", { name: "筛选月份选项", exact: true }) }),
  ).toHaveCSS("opacity", "1");
  await testInfo.attach("saved-column-funnel", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "筛选月份", exact: true }).click();
  await expect(page.getByRole("group", { name: "筛选月份选项", exact: true })).toBeHidden();
  await openNavigationEntry(page, "结算管理", "结算列表");
  await filterServiceColumn(page, "月份", ["2025-01", "2025-02"]);
  await expect(page.getByLabel("列表总数")).toHaveText("共 2 项");
  await filterServiceColumn(page, "流程", ["未发起"]);
  await expect(page.getByLabel("列表总数")).toHaveText("共 2 项");
  await filterServiceColumn(page, "伦理号", ["Z2099003"]);
  await expect(page.getByLabel("列表总数")).toHaveText("共 2 项");
  await page.getByRole("button", { name: "结算月份，点击切换排序", exact: true }).click();
  await expect(page.locator("tbody .ant-table-row").first()).toContainText("2025-01");
  await page.getByRole("button", { name: "筛选结算月份", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "筛选结算月份选项", exact: true }).getByRole("checkbox", { name: /2025-01/ }),
  ).toBeVisible();
  await expect(
    page.locator(".ant-popover").filter({ has: page.getByRole("group", { name: "筛选结算月份选项", exact: true }) }),
  ).toHaveCSS("opacity", "1");
  await testInfo.attach("settlement-column-funnel", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("shared menu and settlement list keep same-PI feeding and service bills separate", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  await loginAndSeed(page);
  await ensureTestInfrastructure(page);
  const month = "2027-01";
  const pi = "技术服务验收负责人";
  const serviceSheet = {
    id: "shared-service",
    month,
    iacuc: "Z2099001",
    facility: "zhujiang",
    serviceId: "large_eye_drops",
    customerType: "internal",
    rows: [
      [1, 2],
      [2, 2],
      [3, 4],
      [10, 2],
    ].map(([day, quantity]) => ({ date: `${month}-${String(day).padStart(2, "0")}`, quantity })),
  };
  expect(
    (await page.request.post("/api/technical-services/sheets", { data: { sheet: serviceSheet } })).ok(),
  ).toBeTruthy();
  const feedingSheet = {
    id: "shared-feeding",
    month,
    roomId: "room-e2e-8014",
    roomName: "8014",
    manager: "系统管理员",
    iacuc: "Z2099001",
    project: "共用结算验收",
    pi,
    owner: "验收实验负责人",
    funding: "验收经费",
    billingUnit: "cage_day",
    animalDetailEnabled: false,
    initialCageCount: 100,
    pageCount: 1,
    rows: [{ id: "shared-feeding-row", date: `${month}-01`, cageCount: 100 }],
  };
  expect((await page.request.post("/api/quantity-sheets", { data: { sheet: feedingSheet } })).ok()).toBeTruthy();
  await openNavigationEntry(page, "结算管理", "结算列表");
  await filterServiceColumn(page, "结算月份", [month]);
  const rows = page.locator("tbody .ant-table-row").filter({ hasText: pi });
  await expect(rows).toHaveCount(2);
  const feeding = rows.filter({ hasText: "饲养费" });
  const technical = rows.filter({ hasText: "技术服务费" });
  await expect(technical).toContainText("300.00");
  const feedingAmount = (
    await (
      await page.request.post("/api/billing-statements/generate-by-pi", {
        data: { month, pi, sourceType: "quantity_sheet", persist: false },
      })
    ).json()
  ).statement.totalAmount as number;
  await expect(feeding).toContainText(feedingAmount.toFixed(2));
  await technical.getByRole("button", { name: /预览结算单/ }).click();
  await expect(page.frameLocator('iframe[title="结算单预览"]').getByText("服务日数：4 合计：300.00 元")).toBeVisible();
  await page
    .getByRole("dialog", { name: new RegExp(pi) })
    .locator(".ant-modal-close")
    .click();
  await expect(page.getByRole("dialog", { name: new RegExp(pi) })).toBeHidden();
  await feeding.getByRole("button", { name: /预览结算单/ }).click();
  await expect(page.frameLocator('iframe[title="结算单预览"]').locator("body")).toContainText("饲养费");
  await page
    .getByRole("dialog", { name: new RegExp(pi) })
    .locator(".ant-modal-close")
    .click();
  await expect(page.getByRole("dialog", { name: new RegExp(pi) })).toBeHidden();
  for (const row of [feeding, technical]) {
    const checkbox = row.getByRole("checkbox");
    await checkbox.click();
    await expect(checkbox).toBeChecked();
  }
  const toolbar = page.getByRole("group", { name: "结算批量操作", exact: true });
  for (const label of ["批量导出 PDF", "批量导出 Excel"]) {
    const downloadPromise = page.waitForEvent("download");
    await toolbar.getByRole("button", { name: label, exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    const path = await download.path();
    expect(path).toBeTruthy();
    await testInfo.attach(label, { path, contentType: "application/zip" });
    execFileSync(
      process.execPath,
      [
        "scripts/run_python.mjs",
        "-c",
        "import sys,zipfile,io; from openpyxl import load_workbook; z=zipfile.ZipFile(sys.argv[1]); names=z.namelist(); assert len(names)==2; files=[z.read(n) for n in names]; assert all(b.startswith(b'%PDF') for b in files) if sys.argv[2]=='PDF' else all(b.startswith(b'PK') for b in files); sheets=[load_workbook(io.BytesIO(b)).active for b in files] if sys.argv[2]!='PDF' else []; tech=[s for s in sheets if s['A1'].value=='实验动物中心技术服务费结算单']; assert (not sheets) or (len(tech)==1 and tech[0]['D3'].value==300 and tech[0]['B3'].value==4)",
        path,
        label.endsWith("PDF") ? "PDF" : "Excel",
      ],
      { stdio: "pipe" },
    );
  }
  await toolbar.getByRole("button", { name: "批量发起结算", exact: true }).click();
  await page
    .getByRole("dialog", { name: "批量发起结算流程", exact: true })
    .getByRole("button", { name: "发起 2 个流程", exact: true })
    .click();
  await expect(page.getByRole("status").filter({ hasText: "已发起 2 个结算流程" })).toBeVisible();
  const workflows = (
    await (
      await page.request.get(
        `/api/billing-workflows?limit=100&offset=0&columnFilters=${encodeURIComponent(JSON.stringify({ month: [month], pi: [pi] }))}`,
      )
    ).json()
  ).items as Array<{ id: string; sourceType: string; totalAmount: number }>;
  expect(workflows).toHaveLength(2);
  const statements = await Promise.all(
    workflows.map(async (workflow) => {
      const sourceType = workflow.sourceType === "pi_merged_technical_service" ? workflow.sourceType : "quantity_sheet";
      const response = await page.request.post(
        sourceType === "quantity_sheet"
          ? "/api/billing-statements/generate-by-pi"
          : "/api/technical-services/settlements/preview",
        { data: { month, pi, sourceType, persist: false } },
      );
      return (await response.json()).statement as { documentNumber: string };
    }),
  );
  expect(statements.every((statement) => Boolean(statement.documentNumber))).toBeTruthy();
  expect(new Set(statements.map((statement) => statement.documentNumber)).size).toBe(2);
  expect(workflows.find((w) => w.sourceType === "pi_merged_technical_service")?.totalAmount).toBe(300);
  for (const width of [1440, 760]) {
    await page.setViewportSize({ width, height: 900 });
    await openNavigationEntry(page, "技术服务费管理", "录入技术服务明细");
    await expect(page.getByRole("heading", { name: "录入技术服务明细", exact: true })).toBeVisible();
    await openNavigationEntry(page, "结算管理", "结算列表");
    if (width < 768) {
      await page.getByRole("tab", { name: "更多" }).click();
      const sheet = page.locator(".ant-mobile-navigation-sheet");
      for (const group of ["饲养费管理", "技术服务费管理", "结算管理"])
        await expect(sheet.getByText(group, { exact: true })).toBeVisible();
      await expect(sheet.getByText("技术服务结算管理", { exact: true })).toHaveCount(0);
      await testInfo.attach("shared-mobile-menu", { body: await page.screenshot(), contentType: "image/png" });
      await sheet.getByRole("button", { name: "关闭", exact: true }).click();
    } else {
      await expect(page.getByRole("menuitem", { name: /技术服务结算管理/ })).toHaveCount(0);
      await testInfo.attach("shared-desktop-menu", { body: await page.screenshot(), contentType: "image/png" });
    }
  }
});
