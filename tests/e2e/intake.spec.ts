import {
  ensureTestInfrastructure,
  expect,
  openBillingNavigation,
  openIntakeEntry,
  openQuantityEntry,
  openSettingsNavigation,
  test,
} from "./fixtures";

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
  await expect(page.getByRole("heading", { name: "数量统计表（录入）", exact: true, level: 2 })).toBeVisible();
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
  await expect(billingMenu.getByRole("menuitem", { name: /数量统计表（录入）/ })).toBeVisible();
});

test("marking a saved batch as printed keeps its server version", async ({ page }) => {
  const batchId = `batch-e2e-print-${Date.now()}`;
  const batchNo = `E2E-PRINT-${Date.now()}`;
  await page.goto("/");
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
  await page.locator("nav.nav").getByRole("button", { name: "笼卡管理", exact: true }).click();
  await page
    .locator("#nav-intake")
    .getByRole("button", { name: /^待接收批次/ })
    .click();
  await expect(page.getByRole("heading", { name: "待接收批次列表", exact: true })).toBeVisible();

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
