import {
  ensureTestInfrastructure,
  expect,
  openIntakeEntry,
  openQuantityEntry,
  openSettingsView,
  openWorkflowCenter,
  test,
} from "./fixtures";

test("login and open the main business workspaces", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  const loginStartedAt = Date.now();
  await page.getByRole("button", { name: "登录", exact: true }).click();

  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  if (!process.env.CI) expect(Date.now() - loginStartedAt).toBeLessThan(1_500);
  await ensureTestInfrastructure(page);
  await openIntakeEntry(page);
  await expect(page.getByRole("heading", { name: "接收与识别", exact: true })).toBeVisible();
  await page
    .getByLabel("预约消息")
    .fill(
      "锐竞采购单号：C2026043035083 饲养需求批次号：（Z2025050）2026042903 供应商：广东南模生物科技有限公司 品系：c57 数量：70 饲养房间：8014 进驻日期：5月13日",
    );
  await page.getByRole("button", { name: "识别文本", exact: true }).click();
  await expect(page.getByLabel("批次号", { exact: true })).toHaveValue("（Z2025050）2026042903");
  await expect(page.getByLabel("数量（只）", { exact: true })).toHaveValue("70");
  await expect(page.getByRole("combobox", { name: "房间", exact: true })).toHaveValue("8014");
  await page.getByRole("button", { name: "扫码识别笼卡", exact: true }).click();
  await expect(page.getByRole("heading", { name: "笼卡识别", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "启动摄像头", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回笼卡管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "接收与识别", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "笼位管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "笼位管理", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /8014-01-A1/ }).click();
  await expect(page.getByRole("heading", { name: /编辑笼位 8014-01-A1/ })).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "多选录入", exact: true }).click();
  await page.getByRole("button", { name: /8014-01-A1/ }).click();
  await expect(page.getByRole("button", { name: "批量编辑", exact: true })).toBeVisible();
  await openQuantityEntry(page);
  await expect(page.getByRole("heading", { name: "数量统计表录入", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "房间号", exact: true }).selectOption({ label: "8014" });
  await page.getByText("动物数量", { exact: true }).click();
  await page.getByLabel("第 1 行增加", { exact: true }).fill("10");
  await page.getByLabel("第 1 行增加类型", { exact: true }).selectOption("购入");
  await expect(page.getByLabel("第 1 行结余总数", { exact: true })).toHaveAttribute("placeholder", "10");
  await openWorkflowCenter(page);
  await expect(page.getByRole("heading", { name: "结算与报销台账", exact: true })).toBeVisible();
  await openSettingsView(page, "房间管理");
  await expect(page.getByRole("heading", { name: "房间管理", exact: true })).toBeVisible();
  await openSettingsView(page, "账号管理");
  await expect(page.getByRole("heading", { name: "账号管理", exact: true })).toBeVisible();
  await openSettingsView(page, "数据管理");
  await expect(page.getByRole("heading", { name: "数据管理", exact: true })).toBeVisible();
  await openSettingsView(page, "操作日志");
  await expect(page.getByRole("heading", { name: "操作日志", exact: true })).toBeVisible();
  await openSettingsView(page, "关于系统");
  await expect(page.getByRole("heading", { name: "关于系统", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "隐藏导航栏", exact: true }).click();
  await expect(page.locator("#nav-settings")).toBeHidden();
  await expect(page.getByRole("button", { name: "展开导航栏", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "展开导航栏", exact: true }).click();
  await page.getByRole("button", { name: "主页", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
});
