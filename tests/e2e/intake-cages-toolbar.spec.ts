import { writeFile } from "node:fs/promises";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { ensureTestInfrastructure, expect, openIntakeEntry, openNavigationEntry, test } from "./fixtures";

test.afterEach(async ({ page }) => {
  await page.request.delete(`/api/intake-batches/toolbar-intake-${page.viewportSize()!.width}`);
  await page.request.delete("/api/racks/rack-e2e-toolbar-2");
});

async function captureToolbar(page: Page, testInfo: TestInfo, name: string, toolbar: Locator) {
  await toolbar.scrollIntoViewIfNeeded();
  const button = toolbar.getByRole("button").first();
  await button.focus();
  await expect(button).toBeFocused();
  await button.hover();
  const height = page.viewportSize()!.height;
  if (height > 500) await expect(toolbar).toHaveCSS("position", "sticky");
  else await expect(toolbar).toHaveCSS("position", "relative");
  const evidence = await toolbar.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      rect: element.getBoundingClientRect().toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth > innerWidth,
      display: style.display,
      gridTemplateColumns: style.gridTemplateColumns,
      gap: style.gap,
      minWidth: style.minWidth,
      overflowX: style.overflowX,
      position: style.position,
      zIndex: style.zIndex,
      buttons: [...element.querySelectorAll("button")].map((item) => ({
        label: item.textContent,
        rect: item.getBoundingClientRect().toJSON(),
        disabled: item.disabled,
      })),
    };
  });
  expect(evidence.overflow).toBe(false);
  expect(evidence.rect.right).toBeLessThanOrEqual(evidence.viewport.width + 1);
  for (const item of evidence.buttons) {
    expect(item.rect.right).toBeLessThanOrEqual(evidence.viewport.width + 1);
    expect(item.rect.height).toBe(32);
  }
  const evidencePath = testInfo.outputPath(`${name}-computed-style.json`);
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  await testInfo.attach(`${name}-computed-style`, { path: evidencePath, contentType: "application/json" });
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1180, height: 900 },
  { width: 760, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`intake and cage toolbars keep actions and scoped selection available at ${viewport.width}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/app");
    await page.getByLabel("用户名", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("admin123");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
    await ensureTestInfrastructure(page);
    const batchId = `toolbar-intake-${viewport.width}`;
    const batchNo = `工具栏验证-${viewport.width}`;
    expect(
      (
        await page.request.post("/api/intake-batches", {
          data: {
            item: {
              id: batchId,
              receiverName: "系统管理员",
              status: "pending_print",
              batchNo,
              iacuc: "Z2026001",
              supplier: "工具栏供应单位",
              pi: "工具栏项目负责人",
              owner: "实验负责人",
              roomName: "8014",
              intakeDate: "2026-09-12",
              endDate: "2026-10-12",
              quantity: 1,
              finalCardCount: 1,
              species: "mouse",
              cards: [],
            },
          },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await page.request.post("/api/racks", {
          data: {
            item: {
              id: "rack-e2e-toolbar-2",
              roomId: "room-e2e-8014",
              name: "工具栏第二笼架",
              index: 2,
              rows: 1,
              cols: 1,
            },
          },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await openIntakeEntry(page);
    const entry = page.getByRole("group", { name: "笼卡录入操作", exact: true });
    await captureToolbar(page, testInfo, "intake-entry", entry);
    await page.getByLabel("结束日期", { exact: true }).scrollIntoViewIfNeeded();
    if (viewport.height > 500) await expect(entry).toBeInViewport({ ratio: 1 });
    await entry.getByRole("button", { name: "保存待接收批次", exact: true }).click({ trial: true });

    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    await page.getByRole("checkbox", { name: `选择 ${batchNo}`, exact: true }).check();
    const batches = page.getByRole("group", { name: "待接收批次批量操作", exact: true });
    await captureToolbar(page, testInfo, "intake-selection", batches);
    await batches.getByRole("button", { name: "清空选择", exact: true }).click();
    await expect(batches).toContainText("已选 0 项");
    await expect(batches).toHaveCSS("position", "relative");

    expect((await page.request.post("/api/intake-batches/mark-printed", { data: { ids: [batchId] } })).ok()).toBe(true);
    expect(
      (
        await page.request.post(`/api/intake-batches/${batchId}/confirm-receipt`, {
          data: { actualReceiptDate: "2026-09-12", cardCount: 1 },
        })
      ).ok(),
    ).toBe(true);
    if (viewport.width <= 760) {
      await page.getByRole("tab", { name: "更多", exact: true }).click();
      await page.locator(".ant-mobile-navigation-sheet").getByText("动态笼位图", { exact: true }).click();
    } else await page.getByRole("menuitem", { name: /笼位管理/ }).click();
    const cages = page.getByRole("group", { name: "笼位图操作", exact: true });
    await cages.getByRole("button", { name: "多选录入", exact: true }).click();
    await cages.getByRole("button", { name: "全选当前", exact: true }).click();
    await expect(cages).toContainText("已选 2 项");
    await captureToolbar(page, testInfo, "cages-selection", cages);
    await cages.getByRole("button", { name: "批量编辑", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "批量编辑 2 个笼位", exact: true })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("combobox", { name: "笼架", exact: true }).click();
    await page
      .locator(".ant-select-dropdown")
      .filter({ visible: true })
      .getByText("工具栏第二笼架", { exact: true })
      .click();
    await expect(cages).toContainText("已选 0 项");
    await expect(cages.getByRole("button", { name: "批量编辑", exact: true })).toBeDisabled();
    await page.getByRole("combobox", { name: "笼架", exact: true }).click();
    await page
      .locator(".ant-select-dropdown")
      .filter({ visible: true })
      .getByText("8014 01 号笼架", { exact: true })
      .click();
    await cages.getByRole("button", { name: /待进驻/ }).click();
    await page
      .getByRole("dialog", { name: "待进驻动物", exact: true })
      .getByRole("button", { name: "选择空笼位", exact: true })
      .click();
    await expect(cages.getByRole("button", { name: "确认预留", exact: true })).toBeDisabled();
    await expect(cages.getByRole("button", { name: "取消预留", exact: true })).toBeEnabled();
    await expect(cages).not.toContainText("正在处理");
    await page.getByRole("button", { name: /8014-01-A1/ }).click();
    await expect(cages.getByRole("button", { name: "确认预留", exact: true })).toBeEnabled();
    await captureToolbar(page, testInfo, "cages-reservation", cages);
    await cages.getByRole("button", { name: "清空选择", exact: true }).click();
    await expect(cages.getByRole("button", { name: "确认预留", exact: true })).toHaveCount(0);
    await page.request.delete(`/api/intake-batches/${batchId}`);
  });
}
