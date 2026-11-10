import { writeFile } from "node:fs/promises";
import type { Locator, Page, TestInfo } from "@playwright/test";
import type { PlacementWriteResponse, RoomWorkspace } from "../../src/contracts/infrastructure";
import { captureUiAudit } from "./uiAudit";
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
        inActions: Boolean(item.closest(".app-command-bar-actions")),
      })),
    };
  });
  expect(evidence.overflow).toBe(false);
  expect(evidence.rect.right).toBeLessThanOrEqual(evidence.viewport.width + 1);
  for (const item of evidence.buttons) {
    if (item.label === "清空选择") expect(item.inActions).toBe(true);
    expect(item.rect.right).toBeLessThanOrEqual(evidence.viewport.width + 1);
    expect(item.rect.height).toBe(evidence.viewport.width < 768 ? 44 : 32);
  }
  const evidencePath = testInfo.outputPath(`${name}-computed-style.json`);
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  await testInfo.attach(`${name}-computed-style`, { path: evidencePath, contentType: "application/json" });
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
}

async function expectPageHeadingAlignment(toolbar: Locator) {
  const heading = toolbar.getByRole("heading");
  await expect(heading).toHaveCSS("font-size", "24px");
  await expect(heading).toHaveCSS("font-weight", "600");
  const layout = await heading.evaluate((element) => {
    const bar = element.closest('[data-ui="workspace-toolbar"]')!;
    const workspace = element.closest(".workspace-view")!;
    return {
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      inset: bar.getBoundingClientRect().left - workspace.getBoundingClientRect().left,
      topInset: bar.getBoundingClientRect().top - workspace.getBoundingClientRect().top,
      insideCard: Boolean(bar.closest(".ant-card")),
    };
  });
  expect(layout.lineHeight).toBeCloseTo(32, 1);
  expect(layout.inset).toBeCloseTo(0, 1);
  expect(layout.topInset).toBeCloseTo(0, 1);
  expect(layout.insideCard).toBe(false);
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
    await expect(entry.getByRole("button", { name: "保存待接收批次", exact: true })).toBeEnabled();
    await expectPageHeadingAlignment(entry);
    await captureToolbar(page, testInfo, "intake-entry", entry);
    await page.getByLabel("结束日期", { exact: true }).scrollIntoViewIfNeeded();
    if (viewport.height > 500) await expect(entry).toBeInViewport({ ratio: 1 });
    await entry.getByRole("button", { name: "保存待接收批次", exact: true }).click({ trial: true });

    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    await page.getByRole("checkbox", { name: `选择 ${batchNo}`, exact: true }).check();
    const batches = page.getByRole("group", { name: "待接收批次批量操作", exact: true });
    await expectPageHeadingAlignment(batches);
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
      await page.locator(".ant-mobile-navigation-sheet").getByText("笼位管理", { exact: true }).last().click();
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
    if (viewport.width === 1440) {
      const room = async () => {
        const response = await page.request.get("/api/infrastructure/rooms/room-e2e-8014?view=cages");
        expect(response.ok()).toBe(true);
        return (await response.json()) as RoomWorkspace;
      };
      let occupancyId = "";
      try {
        await cages.getByRole("button", { name: /待进驻/ }).click();
        const placement = page.getByRole("dialog", { name: "待进驻动物", exact: true });
        await placement.getByRole("button", { name: "选择空笼位", exact: true }).click();
        await page.getByRole("button", { name: /8014-01-A1/ }).click();
        await cages.getByRole("button", { name: "确认预留", exact: true }).click();
        await expect(page.getByRole("status").filter({ hasText: "笼位已预留" })).toBeVisible();
        const reserved = (await room()).placementTasks.find((task) => task.sourceBatchId === batchId)!;
        expect(reserved.status).toBe("reserved");
        occupancyId = reserved.reservedOccupancyId!;
        expect(occupancyId).toBeTruthy();
        await cages.getByRole("button", { name: /待进驻/ }).click();
        let attempts = 0;
        let releaseMoveIn!: () => void;
        const moveInGate = new Promise<void>((resolve) => {
          releaseMoveIn = resolve;
        });
        await page.route(`**/api/placement-tasks/${reserved.id}/move-in`, async (route) => {
          attempts += 1;
          if (attempts > 1) return route.fallback();
          await moveInGate;
          await route.fulfill({ status: 503, json: { error: "测试入驻失败，请重试" } });
        });
        // Ant loading icons contribute a prefix to the button's accessible name.
        const moveIn = placement.getByRole("button", { name: /正式入驻$/ });
        try {
          await moveIn.click();
          await expect(moveIn).toBeDisabled();
          await expect(moveIn).toHaveClass(/ant-btn-loading/);
        } finally {
          releaseMoveIn();
        }
        await expect(placement.getByRole("alert")).toContainText("测试入驻失败，请重试");
        await expect(moveIn).toBeEnabled();
        const failed = await room();
        expect(failed.placementTasks.find((task) => task.id === reserved.id)?.status).toBe("reserved");
        expect(failed.occupancies.find((item) => item.id === occupancyId)?.status).toBe("reserved");
        expect(attempts).toBe(1);
        const labelColors = await placement.getByText("已预留", { exact: true }).evaluate((element) => ({
          text: getComputedStyle(element).color,
          background: getComputedStyle(element).backgroundColor,
        }));
        expect(labelColors.text).not.toBe(labelColors.background);
        await page.screenshot({ path: testInfo.outputPath("placement-error.png"), animations: "disabled" });
        await captureUiAudit(page, testInfo, "placement-recovery", placement);
        expect(attempts).toBe(1);
        const confirmedMoveIn = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === `/api/placement-tasks/${reserved.id}/move-in`,
        );
        await moveIn.click();
        const confirmed = (await (await confirmedMoveIn).json()) as PlacementWriteResponse;
        expect(confirmed.task).toMatchObject({ id: reserved.id, status: "active" });
        expect(confirmed.occupancy).toMatchObject({ id: occupancyId, status: "active" });
        // The cage-room view intentionally omits completed placement tasks.
        await expect
          .poll(async () => {
            const current = await room();
            return [
              current.placementTasks.some((task) => task.id === reserved.id),
              current.occupancies.find((item) => item.id === occupancyId)?.status,
            ];
          })
          .toEqual([false, "active"]);
        expect(attempts).toBe(2);
        await expect(placement.getByRole("alert")).toHaveCount(0);
      } finally {
        if (occupancyId) await page.request.delete(`/api/occupancies/${occupancyId}`);
      }
    }
    await page.request.delete(`/api/intake-batches/${batchId}`);
  });
}
