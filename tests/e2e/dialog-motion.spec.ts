import type { Locator, Page } from "@playwright/test";
import settlementFixture from "../../src/react/print/fixtures/settlement-parity.json" with { type: "json" };
import {
  ensureTestInfrastructure,
  expect,
  openNavigationEntry,
  openSavedQuantitySheets,
  openWorkflowCenter,
  test,
} from "./fixtures";

type MotionEvent = {
  type: string;
  name: string;
  duration: string;
  at: number;
  bodyLength: number;
  inert: boolean;
};
type AuditWindow = Window & { dialogMotion?: MotionEvent[] };
let quantitySheetId: string | undefined;

async function seedQuantitySheet(page: Page) {
  await ensureTestInfrastructure(page);
  quantitySheetId = `motion-quantity-${Date.now()}`;
  const response = await page.request.post("/api/quantity-sheets", {
    data: {
      sheet: {
        id: quantitySheetId,
        month: "2026-02",
        roomId: "room-e2e-8014",
        roomName: "8014",
        manager: "动效验证",
        iacuc: quantitySheetId,
        pi: "动效验证负责人",
        project: "动效验证项目",
        owner: "动效验证",
        funding: "TEST",
        billingUnit: "cage_day",
        animalDetailEnabled: false,
        initialAnimalCount: 0,
        initialCageCount: 1,
        pageCount: 1,
        rows: [],
      },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await auditMotion(page);
}

test.afterEach(async ({ page }) => {
  if (quantitySheetId) {
    const response = await page.request.delete(`/api/quantity-sheets/${quantitySheetId}`);
    expect([200, 404]).toContain(response.status());
    quantitySheetId = undefined;
  }
});

async function auditMotion(page: Page) {
  await page.evaluate(() => {
    (window as AuditWindow).dialogMotion = [];
    for (const type of ["animationstart", "animationend"]) {
      document.addEventListener(type, (rawEvent) => {
        const event = rawEvent as AnimationEvent;
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.matches(".ant-modal, .ant-modal-mask")) return;
        (window as AuditWindow).dialogMotion?.push({
          type,
          name: event.animationName,
          duration: getComputedStyle(target).animationDuration,
          at: performance.now(),
          bodyLength: target.querySelector(".ant-modal-body")?.textContent?.length || 0,
          inert: Boolean(target.querySelector("[inert]")),
        });
      });
    }
  });
}

async function clearMotion(page: Page) {
  await page.evaluate(() => ((window as AuditWindow).dialogMotion = []));
}

async function events(page: Page) {
  return page.evaluate(() => (window as AuditWindow).dialogMotion || []);
}

async function finished(page: Page, suffix: string) {
  await expect
    .poll(async () =>
      (await events(page)).some((event) => event.type === "animationend" && event.name.endsWith(suffix)),
    )
    .toBe(true);
}

async function closeWithMotion(page: Page, close: Locator) {
  await clearMotion(page);
  await close.click();
  await finished(page, "antZoomOut");
  const exit = await events(page);
  expect(exit.some((event) => event.name.endsWith("antFadeOut"))).toBe(true);
  const start = exit.find((event) => event.type === "animationstart" && event.name.endsWith("antZoomOut"))!;
  expect(start.bodyLength).toBeGreaterThan(0);
  expect(start.inert).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await auditMotion(page);
});

test("quantity preview, edit and delete retain exit content and restore keyboard focus", async ({ page }, info) => {
  await seedQuantitySheet(page);
  await openSavedQuantitySheets(page);
  const evidence = [];
  for (const action of ["预览", "编辑", "删除"]) {
    const trigger = page.getByRole("button", { name: action, exact: true }).first();
    await trigger.focus();
    await clearMotion(page);
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await finished(page, "antZoomIn");
    const enter = await events(page);
    expect(enter.find((event) => event.name.endsWith("antZoomIn"))?.duration).toBe("0.3s");
    expect(enter.find((event) => event.name.endsWith("antFadeIn"))?.duration).toBe("0.2s");
    const cancel = dialog.getByRole("button", { name: action === "删除" ? "取消" : "关闭", exact: true }).last();
    await closeWithMotion(page, cancel);
    evidence.push({ action, enter, exit: await events(page) });
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await info.attach("quantity-modal-motion", { body: JSON.stringify(evidence), contentType: "application/json" });
});

test("early Escape and a reduced-motion change during entry or exit release the modal", async ({ page }) => {
  await seedQuantitySheet(page);
  await openSavedQuantitySheets(page);
  const trigger = page.getByRole("button", { name: "预览", exact: true }).first();
  const dialog = page.locator(".quantity-react-preview");
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await trigger.focus();
    await trigger.press("Enter");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(dialog).not.toHaveClass(/ant-zoom-(?:appear|enter)(?:[-\s]|$)/);
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect(dialog).toHaveCSS("transform", "none");
  await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
  await expect(dialog).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await trigger.focus();
  await trigger.press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator(".ant-modal-mask:visible")).toHaveCount(0);
});

test("preview and notice replace each other after exit and never initiate on cancel", async ({ page }, info) => {
  const candidate = {
    id: "motion-candidate",
    pi: "动效负责人",
    month: "2026-09",
    iacucs: ["MOTION-1"],
    totalAmount: 90,
    hasWorkflow: false,
  };
  await page.route("**/api/settlement-candidates?*", (route) =>
    route.fulfill({ json: { items: [candidate], page: { total: 1, limit: 10, offset: 0 } } }),
  );
  const writes: boolean[] = [];
  await page.route("**/api/billing-statements/generate-by-pi", (route) => {
    const body = route.request().postDataJSON() as { persist: boolean };
    writes.push(body.persist);
    return route.fulfill({
      json: {
        ...settlementFixture,
        statement: { ...settlementFixture.statement, pi: candidate.pi, month: candidate.month },
      },
    });
  });
  await openNavigationEntry(page, "结算管理", "结算列表");
  await page.getByRole("button", { name: "预览结算单", exact: true }).click();
  await finished(page, "antZoomIn");
  const preview = page.locator(".settlement-preview-modal .ant-modal");
  await clearMotion(page);
  await preview.getByRole("button", { name: "发起结算流程", exact: true }).click();
  const notice = page.locator(".settlement-notice-modal .ant-modal");
  await expect(notice.getByLabel("邮件正文")).toBeVisible();
  await finished(page, "antZoomIn");
  const transition = await events(page);
  const exitEnd = transition.find((event) => event.type === "animationend" && event.name.endsWith("antZoomOut"))!;
  const enterStart = transition.find((event) => event.type === "animationstart" && event.name.endsWith("antZoomIn"))!;
  expect(enterStart.at).toBeGreaterThanOrEqual(exitEnd.at);
  await expect(page.locator(".ant-modal:visible")).toHaveCount(1);
  await page.evaluate(() => {
    const audit = window as Window & { noticeClipboardPending?: boolean; releaseNoticeClipboard?: () => void };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          new Promise<void>((resolve) => {
            audit.noticeClipboardPending = true;
            audit.releaseNoticeClipboard = resolve;
          }),
      },
    });
  });
  await notice.getByRole("button", { name: "复制并确认", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { noticeClipboardPending?: boolean }).noticeClipboardPending))
    .toBe(true);
  await clearMotion(page);
  await notice.locator(".ant-modal-close").click();
  await expect(preview.getByRole("button", { name: "发起结算流程", exact: true })).toBeVisible();
  await finished(page, "antZoomIn");
  const unexpectedInitiation = page
    .waitForRequest(
      (request) =>
        request.url().endsWith("/api/billing-statements/generate-by-pi") &&
        Boolean((request.postDataJSON() as { persist?: boolean }).persist),
      { timeout: 750 },
    )
    .then(
      () => true,
      () => false,
    );
  await page.evaluate(() => (window as Window & { releaseNoticeClipboard?: () => void }).releaseNoticeClipboard?.());
  expect(await unexpectedInitiation).toBe(false);
  expect(writes).toEqual([false, false]);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    }),
  );
  await preview.getByRole("button", { name: "发起结算流程", exact: true }).click();
  await expect(notice.getByRole("button", { name: "复制并确认", exact: true })).toBeVisible();
  await notice.getByRole("button", { name: "复制并确认", exact: true }).click();
  await expect(preview.getByRole("button", { name: "已发起结算流程", exact: true })).toBeDisabled();
  expect(writes).toEqual([false, false, false, true]);
  await closeWithMotion(page, preview.locator(".ant-modal-close"));
  const restoredTrigger = page.getByRole("button", { name: /预览结算单$/ });
  await expect(restoredTrigger).not.toHaveClass(/ant-btn-loading/);
  await expect(restoredTrigger).toBeFocused();
  await info.attach("preview-notice-transition", { body: JSON.stringify(transition), contentType: "application/json" });
});

test("workflow detail switches to recording; revoke retains input through live motion and theme changes", async ({
  page,
}, info) => {
  const workflow = {
    id: "motion-workflow",
    pi: "动效流程负责人",
    month: "2026-09",
    iacucs: [],
    totalAmount: 90,
    workflowStatus: "statement_archived",
    reimbursementRequired: true,
    reimbursementFormReturned: false,
  };
  await page.route("**/api/billing-workflows?*", (route) =>
    route.fulfill({ json: { items: [workflow], page: { total: 1, limit: 10, offset: 0 } } }),
  );
  await page.route("**/api/billing-workflows/motion-workflow", (route) =>
    route.fulfill({ json: { workflow, events: [], versions: [] } }),
  );
  await page.route("**/api/billing-workflows/funding-book-options?*", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await openWorkflowCenter(page);
  const row = page.getByRole("row").filter({ hasText: workflow.pi });
  await row.getByRole("button", { name: "查看", exact: true }).click();
  await finished(page, "antZoomIn");
  await clearMotion(page);
  await page.getByRole("dialog").getByRole("button", { name: "补录报销单", exact: true }).click();
  const recording = page.getByRole("dialog", { name: /^补录报销单/ });
  await expect(recording.getByRole("button", { name: "保存补录", exact: true })).toBeVisible();
  await finished(page, "antZoomIn");
  const switching = await events(page);
  expect(
    switching.find((event) => event.type === "animationstart" && event.name.endsWith("antZoomIn"))!.at,
  ).toBeGreaterThanOrEqual(
    switching.find((event) => event.type === "animationend" && event.name.endsWith("antZoomOut"))!.at,
  );
  await closeWithMotion(page, recording.getByRole("button", { name: "取消", exact: true }));
  await row.getByRole("button", { name: "撤回", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "撤回结算流程", exact: true });
  const reason = dialog.getByLabel("撤回原因");
  await reason.fill("保留正在填写的撤回原因");
  const input = await reason.elementHandle();
  const geometry = [];
  for (const [width, height] of [
    [1440, 900],
    [1180, 820],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await reason.focus();
    for (const reducedMotion of ["reduce", "no-preference"] as const) {
      await page.emulateMedia({ reducedMotion, colorScheme: reducedMotion === "reduce" ? "dark" : "light" });
      await expect(reason).toBeFocused();
      expect(await reason.evaluate((node, original) => node === original, input)).toBe(true);
      await expect(reason).toHaveValue("保留正在填写的撤回原因");
    }
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    const styles = await dialog.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        display: style.display,
        position: style.position,
        minWidth: style.minWidth,
        overflow: style.overflow,
        zIndex: style.zIndex,
        gap: style.gap,
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    expect(styles.pageOverflow).toBe(false);
    geometry.push({ width, height, box, styles });
    await info.attach(`workflow-dialog-${width}`, { body: await page.screenshot(), contentType: "image/png" });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await clearMotion(page);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await events(page)).filter((event) => /antZoom|antFade/.test(event.name))).toEqual([]);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await clearMotion(page);
  await row.getByRole("button", { name: "撤回", exact: true }).click();
  await expect(dialog.getByLabel("撤回原因")).toHaveValue("");
  await finished(page, "antZoomIn");
  await closeWithMotion(page, dialog.getByRole("button", { name: "取消", exact: true }));
  await info.attach("workflow-switch-and-viewports", {
    body: JSON.stringify({ switching, geometry }),
    contentType: "application/json",
  });
});

test("unsaved batch confirmation preserves the draft on cancel and releases its guard after discard", async ({
  page,
}) => {
  await openNavigationEntry(page, "检疫管理", "检疫批次");
  await page.getByRole("button", { name: "新建检疫批次", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新建检疫批次", exact: true });
  const notes = editor.getByRole("textbox", { name: "检疫批次备注", exact: true });
  await notes.fill("这份草稿只用于取消流程验证");
  const original = await notes.elementHandle();
  const confirmation = page.getByRole("dialog", { name: "离开并放弃未保存的修改？", exact: true });
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await expect(confirmation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(notes).toHaveValue("这份草稿只用于取消流程验证");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await confirmation.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(notes).toHaveValue("这份草稿只用于取消流程验证");
  expect(await notes.evaluate((element, input) => element === input, original)).toBe(true);
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await confirmation.getByRole("button", { name: "放弃修改并离开", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
  await page.getByRole("menuitem", { name: /总览/ }).click();
  await expect(confirmation).toHaveCount(0);
});

test("inspection side editor keeps its native slide exit and reopens with a fresh draft", async ({ page }, info) => {
  await openNavigationEntry(page, "动物管理", "巡检标准");
  await page.getByRole("button", { name: "编辑目录", exact: true }).click();
  const item = page
    .locator(".inspection-editor-tree .ant-tree-treenode:visible")
    .getByText(/^呼吸急促/)
    .first();
  await item.click();
  const drawer = page.locator(".inspection-node-drawer");
  const input = drawer.locator("#name");
  const initialName = await input.inputValue();
  await input.fill(initialName + "（未保存）");
  await page.evaluate(() => {
    document.addEventListener("transitionstart", (event) => {
      if (!(event.target instanceof HTMLElement) || !event.target.matches(".ant-drawer-content-wrapper")) return;
      const root = event.target.closest(".ant-drawer");
      if (root?.classList.contains("ant-drawer-open")) return;
      (window as AuditWindow).dialogMotion?.push({
        type: event.type,
        name: event.propertyName,
        duration: getComputedStyle(event.target).transitionDuration,
        at: performance.now(),
        bodyLength: root?.querySelector(".ant-drawer-body")?.textContent?.length || 0,
        inert: Boolean(root?.querySelector("[inert]")),
      });
    });
  });
  await clearMotion(page);
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  const exit = await events(page);
  const slide = exit.find((event) => event.name === "transform");
  expect(slide?.bodyLength).toBeGreaterThan(0);
  expect(slide?.inert).toBe(true);
  await item.click();
  await expect(input).toHaveValue(initialName);
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await info.attach("inspection-drawer-slide", { body: JSON.stringify(exit), contentType: "application/json" });
});
