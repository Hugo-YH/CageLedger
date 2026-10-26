import type { Page, Route } from "@playwright/test";
import { ensureTestInfrastructure, expect, openNavigationEntry, openSettingsView, test } from "./fixtures";

const batches = Array.from({ length: 12 }, (_, index) => ({
  status: "pending_print",
  intakePurpose: "housing",
  finalCardCount: 2,
  cards: [],
  receipts: [],
  updatedAt: "v1",
  id: `list-read-${index}`,
  batchNo: `LIST-READ-${index}`,
  iacuc: `Z2099${String(index).padStart(3, "0")}`,
  supplier: "验收供应商",
  pi: "负责人",
  owner: "实验负责人",
  intakeDate: "2026-10-01",
  roomName: "8014",
  quantity: 10,
}));

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } });
  expect(response.ok()).toBe(true);
}

async function mockBatches(page: Page) {
  await page.route("**/api/intake-batches?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const limit = Number(params.get("limit") || 10);
    const offset = Number(params.get("offset") || 0);
    return route.fulfill({
      json: {
        items: batches.slice(offset, offset + limit),
        page: { limit, offset, total: batches.length, hasMore: offset + limit < batches.length },
      },
    });
  });
}

test("delayed room directory does not block intake list, page changes, or selection", async ({ page }) => {
  await login(page);
  await mockBatches(page);
  let roomsCompleted = false;
  let roomsStarted = false;
  let releaseRooms!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseRooms = resolve;
  });
  await page.route("**/api/rooms", async (route) => {
    roomsStarted = true;
    await Promise.all([gate, new Promise((resolve) => setTimeout(resolve, 3000))]);
    await route.continue();
    roomsCompleted = true;
  });
  try {
    await page.goto("/app");
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    const list = page.getByRole("region", { name: "待接收批次列表" });
    await expect(list).toBeVisible();
    await list.getByRole("checkbox", { name: "选择 LIST-READ-0" }).check();
    await page.locator(".intake-list-pagination .ant-pagination-next").click();
    await expect(list.getByRole("checkbox", { name: "选择 LIST-READ-10" })).toBeVisible();
    await expect(page.getByText("已选 1 项", { exact: true })).toBeVisible();
    expect(roomsCompleted).toBe(false);
    await expect(page.getByText("正在加载房间信息；列表可先浏览。", { exact: true })).toBeVisible();
    await expect.poll(() => roomsStarted).toBe(true);
  } finally {
    releaseRooms();
  }
  await expect.poll(() => roomsCompleted).toBe(true);
});

test("room failure retries locally and a closed loading editor stays closed after the late response", async ({
  page,
}) => {
  await login(page);
  await mockBatches(page);
  let attempts = 0;
  let retryRoute: Route | undefined;
  await page.route("**/api/rooms", async (route) => {
    attempts += 1;
    if (attempts === 1) await route.fulfill({ status: 403, json: { error: "房间不可用" } });
    else retryRoute = route;
  });
  await page.goto("/app");
  await openNavigationEntry(page, "笼卡管理", "待接收批次");
  await expect(
    page.getByText("房间信息加载失败；列表仍可浏览，请重试后编辑、识别或打印。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重试房间信息" }).click();
  await expect.poll(() => Boolean(retryRoute)).toBe(true);
  const row = page.getByRole("row").filter({ hasText: "LIST-READ-0" });
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑待接收批次" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("编辑所需房间信息");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toBeHidden();
  await retryRoute!.fulfill({ json: { items: [{ id: "room", name: "8014", facility: "zhujiang" }] } });
  await expect(dialog).toBeHidden();
});

test("account list remains usable when its room directory fails", async ({ page }) => {
  await login(page);
  const session = await (await page.request.get("/api/auth/me")).json();
  const other = {
    id: "read-only-test",
    username: "read-only-test",
    displayName: "待管理账号",
    phone: "",
    role: "room_admin",
    roomIds: [],
    active: true,
    updatedAt: "v1",
  };
  await page.route("**/api/users", (route) => route.fulfill({ json: { users: [session.user, other] } }));
  await page.route("**/api/rooms", (route) => route.fulfill({ status: 403, json: { error: "房间不可用" } }));
  await page.goto("/app");
  await openSettingsView(page, "账号管理");
  await expect(page.getByRole("heading", { name: "账号列表" })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(session.user.displayName) }).click();
  await expect(page.getByRole("button", { name: "保存联系电话" })).toBeEnabled();
  await page.getByRole("button", { name: /待管理账号/ }).click();
  await expect(page.getByRole("button", { name: "删除账号" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "保存账号" })).toBeDisabled();
  await expect(page.getByText("饲养间读取失败，当前授权已保留").first()).toBeVisible();
});

test("infrastructure read endpoints enforce actor room scope", async ({ page }) => {
  await login(page);
  await page.goto("/app");
  await ensureTestInfrastructure(page);
  const suffix = Date.now().toString();
  const roomId = `scope-room-${suffix}`;
  const rackId = `scope-rack-${suffix}`;
  const username = `scope-user-${suffix}`;
  expect((await page.request.post("/api/rooms", { data: { item: { id: roomId, name: "范围测试" } } })).ok()).toBe(true);
  expect(
    (
      await page.request.post("/api/racks", {
        data: { item: { id: rackId, roomId, name: "范围架", index: 1, rows: 1, cols: 1 } },
      })
    ).ok(),
  ).toBe(true);
  const created = await page.request.post("/api/users", {
    data: {
      username,
      password: "test-password",
      displayName: "范围账号",
      role: "room_admin",
      roomIds: ["room-e2e-8014"],
    },
  });
  expect(created.ok()).toBe(true);
  const userId = (await created.json()).user.id as string;
  try {
    expect((await page.request.post("/api/auth/login", { data: { username, password: "test-password" } })).ok()).toBe(
      true,
    );
    const structure = await page.request.get("/api/infrastructure/structure");
    expect(structure.status()).toBe(200);
    expect((await structure.json()).rooms.map((room: { id: string }) => room.id)).toEqual(["room-e2e-8014"]);
    expect((await page.request.get("/api/infrastructure/rooms/room-e2e-8014")).status()).toBe(200);
    expect((await page.request.get(`/api/infrastructure/rooms/${roomId}`)).status()).toBe(403);
    expect((await page.request.get("/api/infrastructure/racks/rack-e2e-8014-1/slots")).status()).toBe(200);
    expect((await page.request.get(`/api/infrastructure/racks/${rackId}/slots`)).status()).toBe(403);
    expect((await page.request.get("/api/infrastructure/racks/not-found/slots")).status()).toBe(404);
  } finally {
    await login(page);
    await page.request.delete(`/api/users/${userId}`);
    await page.request.delete(`/api/rooms/${roomId}`);
  }
});
