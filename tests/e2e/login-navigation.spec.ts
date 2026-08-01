import {
  ensureTestInfrastructure,
  expect,
  openBillingNavigation,
  openIntakeEntry,
  openQuantityEntry,
  openSettingsView,
  openWorkflowCenter,
  test,
} from "./fixtures";

test("login and open the main business workspaces", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  const loginStartedAt = Date.now();
  await page.getByRole("button", { name: "登录", exact: true }).click();

  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  if (!process.env.CI) expect(Date.now() - loginStartedAt).toBeLessThan(1_500);
  await ensureTestInfrastructure(page);
  await openIntakeEntry(page);
  await expect(page.getByRole("heading", { name: "接收笼卡", exact: true, level: 2 })).toBeVisible();
  await page
    .getByLabel("预约消息")
    .fill(
      "锐竞采购单号：C2026043035083 饲养需求批次号：（Z2025050）2026042903 供应商：广东南模生物科技有限公司 品系：c57 数量：70 饲养房间：8014 进驻日期：5月13日",
    );
  await page.getByRole("button", { name: "本地识别", exact: true }).click();
  await expect(page.getByLabel("批次号", { exact: true })).toHaveValue("（Z2025050）2026042903");
  await expect(page.getByLabel("数量（只）", { exact: true })).toHaveValue("70");
  await expect(
    page.locator("#intake-room").locator("xpath=ancestor::div[contains(@class, 'ant-select')][1]"),
  ).toContainText("8014");
  await page.getByRole("button", { name: "二维码扫描", exact: true }).click();
  await expect(page.getByRole("heading", { name: "识别笼卡", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "启动摄像头", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回笼卡管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "接收笼卡", exact: true, level: 2 })).toBeVisible();
  await page.getByRole("menuitem", { name: /笼位管理/ }).click();
  await expect(page.getByRole("heading", { name: "动态笼位图", exact: true, level: 2 })).toBeVisible();
  await expect(
    page.locator("#cages-room-select").locator("xpath=ancestor::div[contains(@class, 'ant-select')][1]"),
  ).toContainText("8014");
  await expect(
    page.locator("#cages-rack-select").locator("xpath=ancestor::div[contains(@class, 'ant-select')][1]"),
  ).toContainText("8014 01 号笼架");
  await page.getByRole("button", { name: /8014-01-A1/ }).click();
  await expect(page.getByRole("heading", { name: /编辑笼位 8014-01-A1/ })).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "多选录入", exact: true }).click();
  await page.getByRole("button", { name: /8014-01-A1/ }).click();
  await expect(page.getByRole("button", { name: "批量编辑", exact: true })).toBeVisible();
  await openQuantityEntry(page);
  await expect(page.getByRole("heading", { name: "数量统计表（录入）", exact: true, level: 2 })).toBeVisible();
  await page.getByRole("combobox", { name: "房间号", exact: true }).click();
  await page.locator(".ant-select-dropdown:visible").getByRole("option", { name: "8014", exact: true }).click();
  await expect(
    page.locator("#quantity-sheet-room").locator("xpath=ancestor::div[contains(@class, 'ant-select')][1]"),
  ).toContainText("8014");
  await page.getByRole("switch", { name: "动物数量", exact: true }).click();
  await page.getByLabel("第 1 行增加", { exact: true }).fill("10");
  await page.getByLabel("第 1 行增加类型", { exact: true }).selectOption("购入");
  await expect(page.getByLabel("第 1 行结余总数", { exact: true })).toHaveAttribute("placeholder", "10");
  await openWorkflowCenter(page);
  await expect(page.getByRole("heading", { name: "核销工作台", exact: true, level: 2 })).toBeVisible();
  const billingMenu = await openBillingNavigation(page);
  await billingMenu.getByRole("menuitem", { name: /月度饲养费汇总/ }).click();
  await expect(page.getByRole("heading", { name: "月度饲养费汇总", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByLabel("结算月份", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出月度汇总 Excel", exact: true })).toBeVisible();
  await openSettingsView(page, "房间管理");
  await expect(page.getByRole("heading", { name: "饲养间与笼架", exact: true, level: 2 })).toBeVisible();
  await openSettingsView(page, "账号管理");
  await expect(page.getByRole("heading", { name: "账号列表", exact: true, level: 2 })).toBeVisible();
  await openSettingsView(page, "数据管理");
  await expect(page.getByRole("heading", { name: "项目负责人身份", exact: true, level: 2 })).toBeVisible();
  await openSettingsView(page, "操作日志");
  await expect(page.getByRole("heading", { name: "操作记录", exact: true, level: 2 })).toBeVisible();
  await openSettingsView(page, "关于系统");
  await expect(page.getByRole("heading", { name: "系统状态", exact: true, level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "隐藏导航栏", exact: true }).click();
  await expect(page.locator(".ant-shell")).toHaveClass(/ant-shell-collapsed/);
  await expect(page.getByRole("button", { name: "展开导航栏", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "展开导航栏", exact: true }).click();
  await page.getByRole("menuitem", { name: /主页/ }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await page
    .getByRole("link", { name: /进入系统/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
});
