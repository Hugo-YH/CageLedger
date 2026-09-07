import {
  ensureTestInfrastructure,
  expect,
  openBillingNavigation,
  openIntakeEntry,
  openNavigationEntry,
  openQuantityEntry,
  openSettingsNavigation,
  test,
} from "./fixtures";

test("intake filters remain clickable while the list refreshes", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await openNavigationEntry(page, "笼卡管理", "待接收批次");
  await expect(page.getByRole("region", { name: "待接收批次列表" })).toBeVisible();

  let releaseRefresh: (() => void) | undefined;
  const refreshBlocked = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let requestBlocked: (() => void) | undefined;
  const requestStarted = new Promise<void>((resolve) => {
    requestBlocked = resolve;
  });
  await page.route("**/api/intake-batches?**", async (route) => {
    requestBlocked?.();
    await refreshBlocked;
    await route.continue();
  });

  await page.getByRole("button", { name: "状态，点击切换排序" }).click();
  await requestStarted;
  await expect(page.getByRole("region", { name: "待接收批次列表" })).toHaveAttribute("aria-busy", "true");
  await page.getByRole("button", { name: "筛选批次号" }).click();
  await expect(page.getByPlaceholder("搜索当前列")).toBeVisible();

  releaseRefresh?.();
});

test("intake workspace remains operable at the mobile breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await openIntakeEntry(page);
  await expect(page.getByRole("heading", { name: "接收笼卡", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存待接收批次", exact: true })).toBeVisible();
  await expect(page.getByLabel("预约消息")).toBeVisible();
  await page.getByRole("tab", { name: "更多", exact: true }).click();
  await page.locator(".ant-mobile-navigation-sheet").getByText("动态笼位图", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "动态笼位图", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "房间", exact: true })).toBeVisible();
  await openQuantityEntry(page);
  await expect(page.getByRole("heading", { name: "录入数量统计表", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存统计表", exact: true })).toBeVisible();
});

test("mobile navigation keeps submenus and account actions reachable", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/app");
    await page.getByLabel("用户名", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("admin123");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
    const workspaceBounds = await page.locator(".ant-workspace").boundingBox();
    expect(workspaceBounds?.width).toBe(viewport.width);
    await expect(page.locator(".workspace-view")).toHaveJSProperty("scrollWidth", viewport.width - 32);

    await page.getByRole("tab", { name: "更多", exact: true }).click();
    await expect(page.locator(".ant-mobile-navigation-sheet")).toBeVisible();
    await expect(page.getByText("预约消息识别", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".ant-mobile-navigation-sheet")).toBeHidden();

    const settingsMenu = await openSettingsNavigation(page);
    await expect(settingsMenu).toBeVisible();
    await expect(page.getByRole("button", { name: "刷新页面", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
  }
});

test("tablet navigation keeps account actions inside the settings menu", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();

  const settingsMenu = await openSettingsNavigation(page);
  await expect(page.locator(".ant-sidebar-account")).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新页面", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();

  const bounds = await settingsMenu.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x || 0) + (bounds?.width || 0)).toBeLessThanOrEqual(1024);
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
});

test("landscape phone opens submenus after a desktop navigation collapse", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "隐藏导航栏", exact: true }).click();

  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole("button", { name: "展开导航栏", exact: true }).click();
  const billingMenu = await openBillingNavigation(page);
  await expect(billingMenu).toBeVisible();
  await expect(billingMenu.getByRole("menuitem", { name: /录入数量统计表/ })).toBeVisible();
});

test("marking a saved batch as printed keeps its server version", async ({ page }) => {
  const batchId = `batch-e2e-print-${Date.now()}`;
  const batchNo = `E2E-PRINT-${Date.now()}`;
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await page.request.post("/api/intake-batches", {
    data: {
      item: {
        id: batchId,
        receiverName: "系统管理员",
        status: "pending_print",
        batchNo,
        iacuc: "Z2026001",
        supplier: "广东药康",
        pi: "E2E 打印负责人",
        owner: "E2E 实验负责人",
        roomId: "",
        roomName: "8014",
        intakeDate: new Date().toISOString().slice(0, 10),
        endDate: new Date().toISOString().slice(0, 10),
        quantity: 10,
        suggestedCardCount: 2,
        finalCardCount: 2,
        species: "mouse",
        cards: [],
      },
    },
  });
  await ensureTestInfrastructure(page);
  const intakeGroup = page.getByRole("button", { name: "笼卡管理", exact: true }).or(
    page
      .locator(".ant-main-menu")
      .getByRole("menuitem", { name: /笼卡管理/ })
      .first(),
  );
  await intakeGroup.click();
  await page
    .locator(".ant-main-menu")
    .getByRole("menuitem", { name: /待接收批次/ })
    .click();
  await expect(page.getByRole("region", { name: "待接收批次列表" })).toBeVisible();

  const row = page.locator("tr", { hasText: batchNo }).first();
  await expect(row).toContainText("未打印");
  await row.getByRole("checkbox", { name: `选择 ${batchNo}` }).check();
  await page.getByRole("button", { name: "标记已打印", exact: true }).click();
  await expect(row).toContainText("已打印");

  const response = await page.request.get(`/api/intake-batches/${batchId}`);
  const payload = await response.json();
  expect((payload.item ?? payload).status).toBe("printed");
  await page.request.delete(`/api/intake-batches/${batchId}`);
});

test("intake printing blocks mixed layouts and uses the temporary page size", async ({ page }) => {
  const suffix = Date.now();
  const temporaryId = `batch-e2e-temporary-print-${suffix}`;
  const standardId = `batch-e2e-standard-print-${suffix}`;
  const temporaryBatchNo = `E2E-TEMPORARY-${suffix}`;
  const standardBatchNo = `E2E-STANDARD-${suffix}`;
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await page.request.post("/api/rooms", {
    data: {
      item: {
        id: "room-e2e-8101",
        name: "8101",
        area: "E2E",
        roomManager: "E2E 房间管理员",
        facility: "zhujiang",
        defaultSpecies: "mouse",
        defaultBillingItem: "mouse_standard",
        defaultCustomerType: "internal",
        defaultAnimalCount: 5,
      },
    },
  });
  const createBatch = (id: string, batchNo: string, roomName: string) =>
    page.request.post("/api/intake-batches", {
      data: {
        item: {
          id,
          receiverName: "系统管理员",
          status: "pending_print",
          batchNo,
          iacuc: "Z2026001",
          supplier: "广东药康",
          strainStandard: "C57BL/6J",
          pi: "E2E 打印负责人",
          owner: "E2E 实验负责人",
          roomName,
          intakeDate: "2026-08-26",
          husbandryDays: 31,
          endDate: "2026-09-26",
          quantity: 5,
          suggestedAnimalsPerCage: 5,
          suggestedCardCount: 1,
          finalCardCount: 1,
          species: "mouse",
          cards: [],
        },
      },
    });
  await createBatch(temporaryId, temporaryBatchNo, "8014");
  await createBatch(standardId, standardBatchNo, "8101");
  await page.reload();

  const intakeGroup = page.getByRole("button", { name: "笼卡管理", exact: true }).or(
    page
      .locator(".ant-main-menu")
      .getByRole("menuitem", { name: /笼卡管理/ })
      .first(),
  );
  await intakeGroup.click();
  await page
    .locator(".ant-main-menu")
    .getByRole("menuitem", { name: /待接收批次/ })
    .click();

  const temporaryRow = page.locator("tr", { hasText: temporaryBatchNo }).first();
  const standardRow = page.locator("tr", { hasText: standardBatchNo }).first();
  await temporaryRow.getByRole("checkbox", { name: `选择 ${temporaryBatchNo}` }).check();
  await standardRow.getByRole("checkbox", { name: `选择 ${standardBatchNo}` }).check();
  const printButton = page.getByRole("button", { name: "打印笼卡", exact: true });
  await expect(printButton).toBeDisabled();
  await expect(printButton).toHaveAccessibleDescription("普通饲养间与临时饲养间笼卡不能混合打印，请分开选择。");

  await standardRow.getByRole("checkbox", { name: `选择 ${standardBatchNo}` }).uncheck();
  await expect(printButton).toBeEnabled();
  await printButton.click();
  await expect(page.getByRole("heading", { name: "补齐空白笼卡", exact: true })).toBeVisible();
  await expect(page.getByText("8014 临时饲养间版式", { exact: true })).toBeVisible();
  await expect(page.getByText(/距离整页 15 张还差 14 张/)).toBeVisible();

  await page.request.delete(`/api/intake-batches/${temporaryId}`);
  await page.request.delete(`/api/intake-batches/${standardId}`);
});
