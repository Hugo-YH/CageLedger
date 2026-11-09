import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  expect,
  openIntakeEntry,
  openNavigationEntry,
  openSavedQuantitySheets,
  openWorkflowCenter,
  test,
} from "./fixtures";
import { APP_VERSION } from "../../src/react/version";

// This produces reviewable artifacts only. Publishing screenshots into wiki/public
// is a separate, explicit step; a routine test run never changes documentation.
test("capture current UI with isolated fictional documentation data", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const health = await (await page.request.get("/api/health")).json();
  expect(String(health.database)).toContain("cageledger-e2e-");
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeHidden();

  const roomId = "room-docs-demo";
  const month = new Date().toISOString().slice(0, 7);
  async function post(path: string, data: unknown) {
    const response = await page.request.post(path, { data });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await post("/api/rooms", {
    item: {
      id: roomId,
      name: "演示饲养间",
      area: "文档示例",
      roomManager: "系统管理员",
      facility: "zhujiang",
      defaultSpecies: "mouse",
      defaultBillingItem: "mouse_standard",
      defaultCustomerType: "internal",
      defaultAnimalCount: 4,
    },
  });
  await post("/api/racks", {
    item: { id: "rack-docs-demo", roomId, name: "示例 01 号笼架", index: 1, rows: 4, cols: 6 },
  });
  for (let row = 1; row <= 4; row++) {
    for (let col = 1; col <= 6; col++) {
      await post("/api/cage-slots", {
        item: { id: `slot-docs-${row}-${col}`, rackId: "rack-docs-demo", row, col, status: "empty" },
      });
    }
  }
  for (const [index, initialCageCount] of [18, 12, 8].entries()) {
    const pi = ["示例课题组甲", "示例课题组乙", "示例课题组丙"][index];
    await post("/api/quantity-sheets", {
      sheet: {
        id: `sheet-docs-${index}`,
        month,
        roomId,
        roomName: "演示饲养间",
        manager: "系统管理员",
        iacuc: `DOCS-${index + 1}`,
        project: "文档演示项目",
        pi,
        owner: "示例实验人员",
        funding: "演示项目来源",
        billingUnit: "cage_day",
        animalDetailEnabled: false,
        initialAnimalCount: 0,
        initialCageCount,
        pageCount: 1,
        rows: [{ id: `row-docs-${index}`, date: `${month}-01`, cageCount: initialCageCount }],
      },
    });
    if (index < 2)
      await post("/api/billing-statements/generate-by-pi", {
        pi,
        month,
        sourceType: "quantity_sheet",
        status: "draft",
        persist: true,
        initiate: true,
      });
  }
  for (const [index, day] of ["01", "04", "07"].entries()) {
    const id = `intake-docs-${index}`;
    await post("/api/intake-batches", {
      item: {
        id,
        batchNo: `DOCS-DEMO-${index + 1}`,
        iacuc: `DOCS-${index + 1}`,
        supplier: "演示供应商",
        intakePurpose: "direct_sampling",
        pi: "示例课题组甲",
        owner: "示例实验人员",
        intakeDate: `${month}-${day}`,
        status: "pending_receipt",
        quantity: 8 + index * 4,
        species: "mouse",
        strainRaw: "ICR",
        finalCardCount: 0,
        receipts: [],
      },
    });
    await post("/api/intake-batches/confirm-receipt", { ids: [id], actualReceiptDates: { [id]: `${month}-${day}` } });
  }
  await page.reload();
  const screenshots: { file: string; view: string }[] = [];
  async function capture(file: string, view: string) {
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(file), animations: "disabled" });
    screenshots.push({ file, view });
  }
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await expect(page.locator(".ant-dashboard-task-amount").first()).toBeVisible();
  await page.getByRole("combobox", { name: "选择统计月份", exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").getByText("历史合计", { exact: true }).click();
  await expect(page.getByText("当前统计月份：历史合计", { exact: true })).toBeVisible();
  await expect(page.locator(".ant-dashboard-task-amount")).not.toHaveText("¥0.00");
  await expect(page.locator(".ant-dashboard-chart-loading")).toHaveCount(0);
  await capture("dashboard.png", "总览");
  await openIntakeEntry(page);
  await expect(page.getByRole("heading", { name: "接收笼卡", exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "预约消息", exact: true })
    .fill(
      "【文档演示】示例课题组甲拟接收 ICR 小鼠 12 只，供应商：演示供应商，房间：演示饲养间。请先核对 IACUC、接收日期与饲养用途。",
    );
  await capture("intake.png", "笼卡管理 → 预约消息识别");
  await openSavedQuantitySheets(page);
  await expect(page.getByRole("row").filter({ hasText: "示例课题组甲" })).toBeVisible();
  await capture("quantity-sheets.png", "饲养费管理 → 已保存数量统计表");
  await openNavigationEntry(page, "结算管理", "结算列表");
  await expect(page.getByRole("heading", { name: "结算列表", exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "示例课题组甲" })).toBeVisible();
  await capture("settlements.png", "结算管理 → 结算列表");
  await openWorkflowCenter(page);
  await expect(page.getByRole("row").filter({ hasText: "示例课题组甲" })).toContainText("已发起");
  await capture("workflow.png", "结算管理 → 单据跟踪");
  await openNavigationEntry(page, "检疫管理", "检疫批次");
  await page.getByRole("button", { name: "新建检疫批次", exact: true }).click();
  await page.getByText("手工补充来源（哨兵鼠等）", { exact: true }).click();
  await page.getByRole("combobox", { name: "手工供应商", exact: true }).fill("演示供应商");
  await page.getByRole("button", { name: "添加手工来源" }).click();
  await expect(page.getByText("已添加手工来源", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "检疫批次编号", exact: true }).click();
  await page.getByText("手工补充来源（哨兵鼠等）", { exact: true }).click();
  await page.getByRole("button", { name: "保存检疫批次", exact: true }).scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page
        .getByRole("button", { name: "保存检疫批次", exact: true })
        .evaluate((element) => element.getBoundingClientRect().bottom <= innerHeight),
    )
    .toBe(true);
  await capture("quarantine-batch.png", "检疫管理 → 检疫批次 → 新建检疫批次");
  writeFileSync(
    testInfo.outputPath("capture-manifest.json"),
    JSON.stringify(
      {
        version: APP_VERSION,
        revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        capturedAt: new Date().toISOString(),
        viewport: { width: 1440, height: 960 },
        dataset: "isolated fictional API records; no production data",
        note: "Release acknowledgement only is suppressed by the standard e2e fixture; business requests use the real API.",
        screenshots,
      },
      null,
      2,
    ) + "\n",
  );
});
