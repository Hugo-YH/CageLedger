import { writeFile } from "node:fs/promises";
import type { Locator, Page, Route, TestInfo } from "@playwright/test";
import { ensureTestInfrastructure, expect, openNavigationEntry, openSettingsView, test } from "./fixtures";
import { captureUiAudit } from "./uiAudit";

test.beforeEach(async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
});

async function reconnectWithStaleData(page: Page) {
  await page.clock.setFixedTime(new Date(Date.now() + 60_000));
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

async function captureFormEvidence(page: Page, testInfo: TestInfo, name: string, target: Locator) {
  await captureUiAudit(page, testInfo, name, target);
  for (const [width, height] of [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    if (await target.locator(".inspection-action-form").count()) {
      const save = target.getByRole("button", { name: "保存处置", exact: true });
      await expect(save).toBeInViewport();
      const box = await save.boundingBox();
      expect(box?.y).toBeGreaterThanOrEqual(0);
      expect((box?.y || 0) + (box?.height || 0)).toBeLessThanOrEqual(height);
      await expect(target.locator(".ant-modal-body")).toHaveCSS("overflow-y", "auto");
      for (const control of [
        target.getByLabel("责任人", { exact: true }),
        target.locator(".ant-picker"),
        target.locator(".ant-select"),
      ]) {
        await expect(control).toHaveCSS("height", "32px");
      }
    }
    const styles = await target.evaluate((root) =>
      [
        root,
        ...root.querySelectorAll(".ant-form, .ant-form-item, .ant-space, .ant-alert, .inspection-action-fields"),
      ].map((element) => {
        const style = getComputedStyle(element);
        return {
          className: element.className,
          display: style.display,
          gridTemplateColumns: style.gridTemplateColumns,
          gap: style.gap,
          minWidth: style.minWidth,
          overflow: style.overflow,
          position: style.position,
          zIndex: style.zIndex,
        };
      }),
    );
    const path = testInfo.outputPath(`${name}-${width}-computed.json`);
    await writeFile(path, JSON.stringify(styles, null, 2));
    await testInfo.attach(`${name}-${width}-computed`, {
      path,
      contentType: "application/json",
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("account background refresh failure preserves an expanded editor and retries in place", async ({
  page,
}, testInfo) => {
  const users = [
    {
      id: "resilient-user",
      username: "resilient",
      displayName: "待编辑账号",
      phone: "",
      role: "room_admin",
      roomIds: [],
      updatedAt: "1",
    },
  ];
  let refreshed = false;
  let pending: Route | undefined;
  await page.route("**/api/users", (route) => {
    if (!refreshed) return route.fulfill({ json: { users } });
    pending = route;
  });
  await openSettingsView(page, "账号管理");
  await page.getByRole("button", { name: /待编辑账号 resilient/ }).click();
  const editor = page.locator(".settings-user-editor");
  await editor.getByLabel("显示姓名", { exact: true }).fill("跨刷新保留的输入");
  refreshed = true;
  await reconnectWithStaleData(page);
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: "正在更新" })).toBeVisible();
  await expect(editor.getByLabel("显示姓名", { exact: true })).toBeEnabled();
  await pending?.fulfill({ status: 409, json: { error: "账号更新暂不可用" } });
  const error = page.getByRole("alert").filter({ hasText: "账号与房间信息更新失败" });
  await expect(error).toBeVisible();
  await expect(editor.getByLabel("显示姓名", { exact: true })).toHaveValue("跨刷新保留的输入");
  await captureFormEvidence(page, testInfo, "account-refresh-error", page.locator(".settings-workspace"));
  refreshed = false;
  await error.getByRole("button", { name: "重试" }).click();
  await expect(error).toBeHidden();
  await expect(editor.getByLabel("显示姓名", { exact: true })).toHaveValue("跨刷新保留的输入");
});

test("room background refresh failure keeps the open dialog and typed values", async ({ page }, testInfo) => {
  await ensureTestInfrastructure(page);
  await openSettingsView(page, "房间管理");
  await page.getByRole("button", { name: "新增饲养间", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("饲养间名称", { exact: true }).fill("网络恢复期间保留的房间名称");
  let failed = true;
  await page.route("**/api/bootstrap?scope=full", (route) =>
    failed ? route.fulfill({ status: 409, json: { error: "设施更新暂不可用" } }) : route.continue(),
  );
  await reconnectWithStaleData(page);
  await expect(page.getByRole("alert").filter({ hasText: "基础设施更新失败" })).toBeAttached();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("饲养间名称", { exact: true })).toHaveValue("网络恢复期间保留的房间名称");
  await captureFormEvidence(page, testInfo, "room-refresh-error", dialog);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  failed = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "基础设施更新失败" })).toBeHidden();
});

const finding = {
  id: "resilient-finding",
  inspectionId: "resilient-inspection",
  roomId: "room-e2e-8014",
  roomName: "8014",
  moduleCode: "basicAssessment",
  nodeCode: "A01",
  severity: 1,
  status: "pending",
  locationHint: "测试笼位与需要换行的详细定位信息",
  actionNote: "",
  responsibleName: "",
  updatedAt: "2026-09-12T08:00:00Z",
  attachments: [],
  events: [],
};

test("finding actions serialize requests, keep failed input and announce successful retry", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let refreshFailed = false;
  await page.route("**/api/animal-inspection-findings?*", (route) =>
    refreshFailed
      ? route.fulfill({ status: 409, json: { error: "巡检刷新暂不可用" } })
      : route.fulfill({ json: { items: [finding], page: { limit: 10, offset: 0, total: 1 } } }),
  );
  let actionRoute: Route | undefined;
  let resolveRoute: Route | undefined;
  let saves = 0;
  let closes = 0;
  await page.route("**/api/animal-inspection-findings/resilient-finding/actions", (route) => {
    saves += 1;
    actionRoute = route;
  });
  await page.route("**/api/animal-inspection-findings/resilient-finding/resolve", (route) => {
    closes += 1;
    resolveRoute = route;
  });
  await openNavigationEntry(page, "动物管理", "异常处置");
  await page.getByRole("button", { name: "处置", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("实际措施", { exact: true }).fill("保留的处置草稿");
  await dialog.getByLabel("责任人", { exact: true }).fill("巡检人员");
  await dialog.getByLabel("关闭结论", { exact: true }).fill("复查记录仍需核对");
  await dialog.getByRole("button", { name: "保存处置", exact: true }).click();
  await expect.poll(() => saves).toBe(1);
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认关闭", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("实际措施", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("复查日期", { exact: true })).toBeDisabled();
  expect(closes).toBe(0);
  await actionRoute?.fulfill({ status: 409, json: { error: "处置保存冲突，请核对后重试" } });
  await expect(dialog.getByRole("alert").filter({ hasText: "处置保存冲突" })).toHaveClass(/ant-alert-error/);
  await expect(dialog.getByLabel("实际措施", { exact: true })).toHaveValue("保留的处置草稿");
  await captureFormEvidence(page, testInfo, "finding-save-error", dialog);
  await expect(dialog.getByLabel("责任人", { exact: true })).toHaveCSS("height", "32px");
  await expect(dialog.getByLabel("实际措施", { exact: true })).toBeEnabled();
  refreshFailed = true;
  await dialog.getByRole("button", { name: "保存处置", exact: true }).click();
  await expect.poll(() => saves).toBe(2);
  await actionRoute?.fulfill({ json: { item: finding } });
  await expect(dialog.getByRole("status")).toContainText("处置记录已保存");
  await expect(page.getByRole("alert").filter({ hasText: "巡检信息更新失败" })).toBeAttached();
  await expect(dialog.getByLabel("关闭结论", { exact: true })).toHaveValue("复查记录仍需核对");
  await dialog.getByRole("button", { name: "确认关闭", exact: true }).click();
  await expect.poll(() => closes).toBe(1);
  await expect(dialog.getByRole("button", { name: "保存处置", exact: true })).toBeDisabled();
  await resolveRoute?.fulfill({ status: 409, json: { error: "关闭暂未成功，请重试" } });
  await expect(dialog.getByRole("alert").filter({ hasText: "关闭暂未成功" })).toHaveClass(/ant-alert-error/);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  refreshFailed = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "巡检信息更新失败" })).toBeHidden();
});

test("inspection detail shows loading before an actual error and supports retry", async ({ page }) => {
  await page.route("**/api/animal-inspections?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "resilient-inspection",
            roomName: "8014",
            moduleCodes: ["basicAssessment"],
            status: "submitted",
            createdByName: "巡检人员",
            updatedAt: "2026-09-12T08:00:00Z",
          },
        ],
        page: { limit: 10, offset: 0, total: 1 },
        filterOptions: { rooms: ["8014"] },
      },
    }),
  );
  let detailRoute: Route | undefined;
  await page.route("**/api/animal-inspections/resilient-inspection", (route) => {
    detailRoute = route;
  });
  await openNavigationEntry(page, "动物管理", "巡检记录");
  await page.getByRole("button", { name: "详情", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("status")).toBeVisible();
  await expect(dialog.getByText("巡检记录详情加载失败", { exact: true })).toBeHidden();
  await expect.poll(() => Boolean(detailRoute)).toBe(true);
  await detailRoute?.fulfill({ status: 409, json: { error: "详情暂不可用" } });
  await expect(dialog.getByText("巡检记录详情加载失败", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "重试", exact: true }).click();
  await expect(dialog.getByRole("status")).toBeVisible();
  await expect(dialog.getByText("巡检记录详情加载失败", { exact: true })).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
