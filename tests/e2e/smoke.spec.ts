import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

async function ensureTestInfrastructure(page: Page) {
  const response = await page.request.get("/api/rooms");
  const payload = (await response.json()) as { items?: Array<{ id: string; name: string }> };
  if ((payload.items || []).some((room) => room.name === "8014")) return;
  await page.request.post("/api/rooms", {
    data: {
      item: {
        id: "room-e2e-8014",
        name: "8014",
        area: "E2E",
        facility: "zhujiang",
        defaultSpecies: "mouse",
        defaultBillingItem: "mouse_standard",
        defaultCustomerType: "internal",
        defaultAnimalCount: 1,
      },
    },
  });
  await page.request.post("/api/racks", {
    data: {
      item: { id: "rack-e2e-8014-1", roomId: "room-e2e-8014", name: "8014 01 号笼架", index: 1, rows: 1, cols: 2 },
    },
  });
  await page.request.post("/api/cage-slots", {
    data: { item: { id: "slot-e2e-8014-a01", rackId: "rack-e2e-8014-1", row: 1, col: 1, status: "empty" } },
  });
  await page.request.post("/api/cage-slots", {
    data: { item: { id: "slot-e2e-8014-a02", rackId: "rack-e2e-8014-1", row: 1, col: 2, status: "empty" } },
  });
  await page.reload();
}

test("login and open the main business workspaces", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  const loginStartedAt = Date.now();
  await page.getByRole("button", { name: "登录", exact: true }).click();

  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  expect(Date.now() - loginStartedAt).toBeLessThan(1_500);
  await ensureTestInfrastructure(page);
  await page.getByRole("button", { name: "笼卡管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "笼卡管理", exact: true })).toBeVisible();
  await page
    .getByLabel("预约消息")
    .fill(
      "锐竞采购单号：C2026043035083 饲养需求批次号：（Z2025050）2026042903 供应商：广东南模生物科技有限公司 品系：c57 数量：70 饲养房间：8014 进驻日期：5月13日",
    );
  await page.getByRole("button", { name: "识别文本", exact: true }).click();
  await expect(page.getByLabel("批次号", { exact: true })).toHaveValue("（Z2025050）2026042903");
  await expect(page.getByLabel("数量（只）", { exact: true })).toHaveValue("70");
  await expect(page.getByRole("combobox", { name: "房间", exact: true })).toHaveValue("8014");
  await page.getByRole("button", { name: "笼卡识别", exact: true }).click();
  await expect(page.getByRole("heading", { name: "笼卡识别", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "启动摄像头", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回笼卡管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "笼卡管理", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "笼位管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "笼位管理", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /8014-01-A1/ }).click();
  await expect(page.getByRole("heading", { name: /编辑笼位 8014-01-A1/ })).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "多选录入", exact: true }).click();
  await page.getByRole("button", { name: /8014-01-A1/ }).click();
  await expect(page.getByRole("button", { name: "批量编辑", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "饲养费管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "饲养费管理", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "房间号", exact: true }).selectOption({ label: "8014" });
  await page.getByText("动物数量", { exact: true }).click();
  await page.getByLabel("第 1 行增加", { exact: true }).fill("10");
  await page.getByLabel("第 1 行增加类型", { exact: true }).selectOption("购入");
  await expect(page.getByLabel("第 1 行结余总数", { exact: true })).toHaveAttribute("placeholder", "10");
  await page.getByRole("button", { name: "流程中心", exact: true }).click();
  await expect(page.getByRole("heading", { name: "流程中心", exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "主页", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
});

async function openSettingsView(page: Page, name: string) {
  await page.getByRole("button", { name: "系统设置", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}

test("intake workspace remains operable at the mobile breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await page.getByRole("button", { name: "笼卡管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "笼卡管理", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存待接收批次", exact: true })).toBeVisible();
  await expect(page.getByLabel("预约消息")).toBeVisible();
  await page.getByRole("button", { name: "笼位管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "笼位管理", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "房间", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "饲养费管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "数量统计表（录入）", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存统计表", exact: true })).toBeVisible();
});

test("save and delete a quantity sheet in the ephemeral database", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await page.getByRole("button", { name: "饲养费管理", exact: true }).click();
  await page.getByRole("combobox", { name: "房间号", exact: true }).selectOption({ label: "8014" });
  await page.getByRole("combobox", { name: "IACUC 编号", exact: true }).fill("E2E-IACUC-001");
  await page.locator("form").getByLabel("项目负责人", { exact: true }).fill("E2E负责人");
  await page.getByLabel("第 1 行结余笼数", { exact: true }).fill("2");
  await page.getByRole("button", { name: "保存统计表", exact: true }).click();
  await expect(page.getByRole("heading", { name: "确认保存数量统计表", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("统计表已保存");
  const savedRow = page.getByRole("row", { name: /E2E-IACUC-001/ });
  await expect(savedRow).toBeVisible();
  await savedRow.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(savedRow).toHaveCount(0);
});

test("admin can create infrastructure and manage a room account", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await openSettingsView(page, "房间管理");
  const roomName = `E2E 测试饲养间 ${Date.now()}`;
  await page.getByRole("button", { name: "新增饲养间", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCSS("position", "relative");
  await expect(page.locator(".modal-backdrop")).toHaveCSS("position", "fixed");
  await page.getByLabel("饲养间名称", { exact: true }).fill(roomName);
  await page.getByLabel("区域", { exact: true }).fill("E2E 区域");
  await page.getByRole("button", { name: "保存饲养间", exact: true }).click();
  await expect(page.getByText(roomName, { exact: true })).toBeVisible();
  await openSettingsView(page, "账号管理");
  await page.getByLabel("登录名", { exact: true }).fill("e2e_room_admin");
  await page.getByLabel("显示姓名", { exact: true }).fill("E2E 房间管理员");
  await page.getByLabel("初始密码", { exact: true }).fill("e2e-password");
  await page.getByLabel(roomName, { exact: true }).check();
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  const userCard = page.locator(".user-card").filter({ hasText: "E2E 房间管理员" });
  await expect(userCard).toBeVisible();
  await userCard.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(userCard).toHaveCount(0);
});

test("room administrator keeps the server-side permission boundary", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  const username = `e2e_room_${Date.now()}`;
  const createResponse = await page.request.post("/api/users", {
    data: {
      username,
      displayName: "E2E 权限管理员",
      password: "e2e-password",
      role: "room_admin",
      roomIds: ["room-e2e-8014"],
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const created = (await createResponse.json()) as { user: { id: string } };
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill("e2e-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("房间管理员 · 1 个饲养间", { exact: true })).toBeVisible();
  await openSettingsView(page, "房间管理");
  await expect(page.getByRole("button", { name: "新增饲养间", exact: true })).toHaveCount(0);
  const usersResponse = await page.request.get("/api/users");
  expect(usersResponse.status()).toBe(403);
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("管理员 · 全部饲养间", { exact: true })).toBeVisible();
  expect((await page.request.delete(`/api/users/${created.user.id}`)).ok()).toBeTruthy();
});

test("public cage card deep links stay on the React entry", async ({ page }) => {
  await page.goto("/c/UNKNOWN-E2E");
  await expect(page.getByRole("heading", { name: "未找到笼卡信息", exact: true })).toBeVisible();
  await expect(page.getByText("UNKNOWN-E2E", { exact: true })).toBeVisible();
});
