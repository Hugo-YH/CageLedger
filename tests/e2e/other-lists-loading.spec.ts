import type { Page, Route } from "@playwright/test";
import { expect, openNavigationEntry, openSettingsView, test } from "./fixtures";

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
}

async function nextPage(page: Page) {
  await page.locator(".ant-pagination-next:visible").last().click();
}
async function expectCurrentPage(page: Page, value: string) {
  await expect(page.locator(".ant-pagination-item-active:visible").last()).toHaveText(value);
}

type PageResponse = (offset: number, limit: number) => object;
async function mockPages(page: Page, path: string, response: PageResponse) {
  let fail = true;
  await page.route(path, async (route: Route) => {
    const params = new URL(route.request().url()).searchParams;
    const offset = Number(params.get("offset") || 0);
    const limit = Number(params.get("limit") || 30);
    if (offset > 0 && fail) return route.fulfill({ status: 403, json: { error: "第二页读取失败" } });
    await route.fulfill({ json: response(offset, limit) });
  });
  return () => {
    fail = false;
  };
}
const resultPage = (offset: number, limit: number) => ({ offset, limit, total: limit * 2, hasMore: offset === 0 });

for (const kind of ["settlement", "service", "inspection", "audit", "feedback", "quarantine"] as const) {
  test(`${kind} keeps the previous page on failure and retries`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    const session = (await (await page.request.get("/api/auth/me")).json()) as { user: { id: string } };
    let writes = 0;
    page.on("request", (request) => {
      if (
        request.method() !== "GET" &&
        /\/api\/(billing-statements|billing-workflows|technical-services\/settlements|pdf-jobs)/.test(
          new URL(request.url()).pathname,
        )
      )
        writes++;
    });
    const first = `列表验收${kind}第一页`;
    const second = `列表验收${kind}第二页`;
    const unblock = await mockPages(
      page,
      {
        settlement: "**/api/settlement-candidates?*",
        service: "**/api/technical-services/sheets?*",
        inspection: "**/api/animal-inspections?*",
        audit: "**/api/audit-events?*",
        feedback: "**/api/feedback?*",
        quarantine: "**/api/quarantine/records?*",
      }[kind],
      (offset, limit) => {
        const label = offset ? second : first;
        const pageInfo = resultPage(offset, limit);
        if (kind === "settlement")
          return {
            items: [
              {
                id: label,
                month: "2026-10",
                pi: label,
                iacucs: ["Z20261001"],
                manager: "验收",
                totalAmount: 123.45,
                hasWorkflow: false,
                workflowStatus: "",
              },
            ],
            page: pageInfo,
            filterOptions: {},
          };
        if (kind === "service")
          return {
            items: [
              {
                id: label,
                month: "2026-10",
                iacuc: "Z20261001",
                pi: label,
                facility: "zhujiang",
                serviceId: "test",
                serviceName: "验收服务",
                customerType: "internal",
                unit: "次",
                unitPrice: 10,
                totalAmount: 10,
                totalQuantity: 1,
                serviceDayCount: 1,
                protected: false,
                updatedAt: "2026-10-01",
              },
            ],
            page: pageInfo,
            filterOptions: {},
          };
        if (kind === "inspection")
          return {
            items: [
              {
                id: label,
                roomId: label,
                roomName: label,
                moduleCodes: [],
                status: "draft",
                catalogVersion: "1",
                createdBy: session.user.id,
                createdByName: "管理员",
                createdAt: "2026-10-01",
                updatedAt: "2026-10-01",
                snapshot: { iacucs: [], pis: [], species: [], animalCount: 0, cageCodes: [] },
              },
            ],
            page: pageInfo,
            filterOptions: { rooms: [first, second] },
          };
        if (kind === "audit")
          return {
            items: [{ id: label, message: label, action: "test", at: "2026-10-01", actorDisplayName: "管理员" }],
            page: pageInfo,
          };
        if (kind === "feedback")
          return {
            items: [
              {
                id: label,
                number: offset ? 2 : 1,
                title: label,
                kind: "bug",
                module: "反馈",
                status: "pending",
                syncStatus: "pending",
                createdBy: { id: session.user.id, name: "管理员" },
                createdAt: "2026-10-01",
                updatedAt: "2026-10-01",
                encounterCount: 0,
                encountered: false,
                assignees: [],
                version: 1,
              },
            ],
            total: pageInfo.total,
            limit,
            offset,
          };
        return {
          items: [
            {
              id: label,
              testId: label,
              batchId: label,
              batchName: label,
              method: "elisa_mouse",
              testDate: "2026-10-01",
              samplingDate: "2026-10-01",
              state: "draft",
              sampleCount: 1,
              projectCount: 1,
              abnormalCount: 0,
              suppliers: ["验收供应商"],
              updatedAt: "2026-10-01",
              retestOf: "",
              correctionOf: "",
            },
          ],
          page: pageInfo,
          summary: { total: pageInfo.total, draft: pageInfo.total, issued: 0 },
        };
      },
    );
    if (kind === "audit") await openSettingsView(page, "操作日志");
    else if (kind === "feedback") await page.getByRole("menuitem", { name: /帮助与反馈/ }).click();
    else {
      const [group, entry] = {
        settlement: ["结算管理", "结算列表"],
        service: ["技术服务费管理", "已保存技术服务明细"],
        inspection: ["动物管理", "巡检记录"],
        quarantine: ["检疫管理", "ELISA检测"],
      }[kind];
      await openNavigationEntry(page, group, entry);
    }
    await expect(page.getByText(first, { exact: true }).first()).toBeVisible();
    if (kind === "settlement") {
      await page.getByRole("checkbox", { name: `选择 ${first} 2026-10 结算项` }).check();
      await expect(page.getByText("123.45", { exact: false }).first()).toBeVisible();
    }
    await nextPage(page);
    const alert = page.getByRole("alert").filter({
      hasText:
        kind === "service"
          ? "明细列表读取失败"
          : kind === "settlement"
            ? "结算列表加载失败"
            : kind === "inspection"
              ? "巡检信息更新失败"
              : kind === "audit"
                ? "操作日志更新失败"
                : kind === "feedback"
                  ? "反馈列表更新失败"
                  : "第二页读取失败",
    });
    await expect(alert).toBeVisible();
    await expect(page.getByText(first, { exact: true }).first()).toBeVisible();
    await expectCurrentPage(page, "1");
    if (kind === "settlement") await expect(page.getByRole("button", { name: "筛选项目负责人姓名" })).toBeEnabled();
    if (kind === "service") await expect(page.getByRole("button", { name: "筛选IACUC" })).toBeEnabled();
    if (kind === "inspection") await expect(page.getByRole("button", { name: "新建巡检" })).toBeEnabled();
    if (kind === "feedback") await expect(page.getByRole("button", { name: "提交反馈" })).toBeEnabled();
    if (kind === "quarantine") await expect(page.getByRole("button", { name: "新建检测记录" })).toBeEnabled();
    if (kind === "settlement") {
      const toolbar = page.getByRole("group", { name: "结算批量操作" });
      await expect(toolbar.getByRole("button", { name: "发起结算流程" })).toBeDisabled();
      await expect(toolbar.getByRole("button", { name: "导出 PDF" })).toBeDisabled();
      await expect(page.getByRole("checkbox", { name: `选择 ${first} 2026-10 结算项` })).toBeChecked();
      expect(writes).toBe(0);
    }
    if (kind === "service")
      await expect(
        page.getByRole("row").filter({ hasText: first }).getByRole("button", { name: "预览" }),
      ).toBeDisabled();
    if (kind === "inspection")
      await expect(
        page.getByRole("row").filter({ hasText: first }).getByRole("button", { name: "继续编辑" }),
      ).toBeDisabled();
    if (kind === "feedback") await expect(page.getByRole("button", { name: `查看反馈 #1：${first}` })).toBeDisabled();
    if (kind === "quarantine")
      await expect(
        page.getByRole("row").filter({ hasText: first }).getByRole("button", { name: "查看检测记录" }),
      ).toBeDisabled();
    unblock();
    await alert.getByRole("button", { name: /重\s*试/ }).click();
    await expect(page.getByText(second, { exact: true }).first()).toBeVisible();
    await expectCurrentPage(page, "2");
    if (kind === "service")
      await expect(
        page.getByRole("row").filter({ hasText: second }).getByRole("button", { name: "预览" }),
      ).toBeEnabled();
    if (kind === "inspection")
      await expect(
        page.getByRole("row").filter({ hasText: second }).getByRole("button", { name: "继续编辑" }),
      ).toBeEnabled();
    if (kind === "feedback") await expect(page.getByRole("button", { name: `查看反馈 #2：${second}` })).toBeEnabled();
    if (kind === "quarantine")
      await expect(
        page.getByRole("row").filter({ hasText: second }).getByRole("button", { name: "查看检测记录" }),
      ).toBeEnabled();
    expect(writes).toBe(0);
  });
}

test("data quality scan changes never display another scan's findings", async ({ page }) => {
  await login(page);
  const scan = (id: string) => ({
    id,
    scannedAt: id === "scan-a" ? "2026-10-01" : "2026-10-02",
    detectorVersion: "1",
    latestBusinessAt: "",
    scope: id,
    trigger: "upgrade",
    actorName: "管理员",
    sourceSha256: "",
    sourceSnapshot: null,
    findingCount: 1,
    needsReview: 1,
    retainedHistory: 0,
    categories: [],
  });
  await page.route("**/api/data-quality/scans?*", (route) =>
    route.fulfill({
      json: { items: [scan("scan-a"), scan("scan-b")], page: { offset: 0, limit: 20, total: 2, hasMore: false } },
    }),
  );
  let pending: Route | undefined;
  await page.route("**/api/data-quality/scans/*/issues?*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[4];
    if (id === "scan-b") {
      pending = route;
      return;
    }
    await route.fulfill({
      json: {
        scan: scan(id),
        items: [
          {
            id: "finding-a",
            code: "test",
            codeLabel: "验收",
            summary: "首份扫描独有问题",
            reviewStatus: "needs_review",
            reviewStatusLabel: "待核对",
            entityType: "test",
            entityTypeLabel: "验收",
            entityId: "1",
            referenceId: "",
          },
        ],
        page: { offset: 0, limit: 10, total: 1, hasMore: false },
        filterOptions: { code: [], reviewStatus: [] },
      },
    });
  });
  await openSettingsView(page, "数据核查");
  await expect(page.getByText("首份扫描独有问题")).toBeVisible();
  await page.getByLabel("核查留档", { exact: true }).click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(page.getByText("首份扫描独有问题")).toHaveCount(0);
  await pending!.fulfill({ status: 403, json: { error: "第二份扫描不可用" } });
  await expect(page.getByText("核查问题加载失败")).toBeVisible();
  await expect(page.getByText("首份扫描独有问题")).toHaveCount(0);
});

test("quarantine method changes never display the previous method's rows", async ({ page }) => {
  await login(page);
  let pending: Route | undefined;
  await page.route("**/api/quarantine/records?*", async (route) => {
    const method = new URL(route.request().url()).searchParams.get("method");
    if (method === "elisa_rat") {
      pending = route;
      return;
    }
    await route.fulfill({
      json: {
        items: [
          {
            id: "mouse-test",
            testId: "mouse-test",
            batchId: "batch-a",
            batchName: "小鼠方法独有批次",
            method: "elisa_mouse",
            testDate: "2026-10-01",
            samplingDate: "2026-10-01",
            state: "draft",
            sampleCount: 1,
            projectCount: 1,
            abnormalCount: 0,
            suppliers: ["供应商"],
            updatedAt: "2026-10-01",
            retestOf: "",
            correctionOf: "",
          },
        ],
        page: { offset: 0, limit: 30, total: 1, hasMore: false },
        summary: { total: 1, draft: 1, issued: 0 },
      },
    });
  });
  await openNavigationEntry(page, "检疫管理", "ELISA检测");
  await expect(page.getByText("小鼠方法独有批次")).toBeVisible();
  await page.getByLabel("检测方法筛选").click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(page.getByText("小鼠方法独有批次")).toHaveCount(0);
  await pending!.fulfill({ status: 403, json: { error: "大鼠方法不可用" } });
  await expect(page.getByText("大鼠方法不可用")).toBeVisible();
  await expect(page.getByText("小鼠方法独有批次")).toHaveCount(0);
});

test("supplier details retain their page on failure and isolate supplier groups", async ({ page }) => {
  await login(page);
  const group = (supplier: string) => ({
    supplier,
    method: "elisa_mouse",
    retest: false,
    intakeCount: 20,
    batchCount: 20,
    poolCount: 20,
    portionCount: 20,
    confirmed: 0,
    pending: 0,
    resolved: 0,
    normal: 20,
    incomplete: 0,
  });
  await page.route("**/api/quarantine/suppliers/summary?*", (route) =>
    route.fulfill({
      json: { items: [group("供应商甲"), group("供应商乙")], page: { offset: 0, limit: 10, total: 2, hasMore: false } },
    }),
  );
  let fail = true;
  let otherGroup: Route | undefined;
  await page.route("**/api/quarantine/suppliers/details?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const supplier = params.get("groupSupplier");
    const offset = Number(params.get("offset") || 0);
    if (supplier === "供应商乙") {
      otherGroup = route;
      return;
    }
    if (offset && fail) return route.fulfill({ status: 403, json: { error: "明细第二页失败" } });
    const items = Array.from({ length: 10 }, (_, index) => ({
      batchId: `batch-${offset + index}`,
      batchName: `甲批次${offset + index + 1}`,
      testId: `test-${offset + index}`,
      testDate: "2026-10-01",
      status: "normal",
      sharedPools: false,
    }));
    await route.fulfill({ json: { items, page: { offset, limit: 10, total: 20, hasMore: offset === 0 } } });
  });
  await openNavigationEntry(page, "检疫管理", "检疫报告");
  await page.getByRole("tab", { name: "供应商历史", exact: true }).click();
  const first = page.getByRole("cell", { name: "供应商甲", exact: true }).locator("..");
  const second = page.getByRole("cell", { name: "供应商乙", exact: true }).locator("..");
  await first.getByRole("button", { name: "展开行" }).click();
  const firstButton = page.getByRole("button", { name: "甲批次1 · 2026-10-01" });
  await expect(firstButton).toBeVisible();
  const detail = page.locator(".ant-table-expanded-row:visible").first();
  await detail.locator(".ant-pagination-next").click();
  const error = detail.getByRole("alert").filter({ hasText: "明细更新失败，暂显示上次结果" });
  await expect(error).toBeVisible();
  await expect(firstButton).toBeVisible();
  await expect(firstButton).toBeDisabled();
  await expect(detail.locator(".ant-pagination-item-active")).toHaveText("1");
  fail = false;
  await error.getByRole("button", { name: /重\s*试/ }).click();
  await expect(page.getByRole("button", { name: "甲批次11 · 2026-10-01" })).toBeEnabled();
  await expect(detail.locator(".ant-pagination-item-active")).toHaveText("2");
  await first.getByRole("button", { name: "关闭行" }).click();
  await second.getByRole("button", { name: "展开行" }).click();
  await expect.poll(() => Boolean(otherGroup)).toBe(true);
  await expect(page.getByRole("button", { name: "甲批次11 · 2026-10-01" })).toBeHidden();
  await otherGroup!.fulfill({ status: 403, json: { error: "乙分组不可用" } });
  await expect(page.getByText("明细读取失败")).toBeVisible();
  await expect(page.getByRole("button", { name: "甲批次11 · 2026-10-01" })).toBeHidden();
});

test("saved quantity keeps selection and the displayed page after page failure", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const releaseFailure = await mockPages(page, "**/api/quantity-sheets?*", (offset, limit) => ({
    items: [
      {
        id: offset ? "quantity-page-2" : "quantity-page-1",
        month: "2026-10",
        iacuc: offset ? "Z20261002" : "Z20261001",
        roomId: "room-1",
        roomName: "验收房间",
        manager: "管理员",
        roomManager: "管理员",
        project: "验收项目",
        pi: "验收负责人",
        owner: "实验人",
        contact: "",
        funding: "验收经费",
        initialCageCount: 1,
        initialAnimalCount: 1,
        billingUnit: "cage_day",
        updatedAt: "2026-10-01",
      },
    ],
    page: resultPage(offset, limit),
  }));
  await openNavigationEntry(page, "饲养费管理", "已保存数量统计表");
  const selected = page.getByRole("checkbox", { name: "选择 Z20261001" });
  await selected.check();
  await page.locator(".quantity-saved-pagination .ant-pagination-next").click();
  const error = page.getByRole("alert").filter({ hasText: "列表更新失败，当前显示上次成功结果" });
  await expect(error).toBeVisible();
  await expect(page.locator(".quantity-saved-pagination .ant-pagination-item-active")).toHaveText("1");
  await expect(selected).toBeChecked();
  await expect(selected).toBeDisabled();
  const oldRow = page.getByRole("row").filter({ hasText: "Z20261001" });
  await expect(oldRow.getByRole("button", { name: "编辑", exact: true })).toBeDisabled();
  await expect(oldRow.getByRole("button", { name: "预览", exact: true })).toBeDisabled();
  releaseFailure();
  await error.getByRole("button", { name: /重\s*试/ }).click();
  await expect(page.getByRole("row").filter({ hasText: "Z20261002" })).toBeVisible();
  await expect(page.locator(".quantity-saved-pagination .ant-pagination-item-active")).toHaveText("2");
  await expect(
    page.getByRole("row").filter({ hasText: "Z20261002" }).getByRole("button", { name: "编辑", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("group", { name: "已保存统计表操作" }).getByText("已选 1 项")).toBeVisible();
});
