import { execFileSync } from "node:child_process";
import { ensureTestInfrastructure, expect, openIntakeEntry, openNavigationEntry, test } from "./fixtures";
import type { Page } from "@playwright/test";

async function loginAndOpenEntry(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await openIntakeEntry(page);
}

async function expectDirectFields(page: Page) {
  await expect(page.getByRole("heading", { name: "直接取材预约", exact: true })).toBeVisible();
  for (const label of ["房间", "结束日期", "饲养周期（天）", "打印张数"]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByLabel("接收日期", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "打印当前笼卡", exact: true })).toHaveCount(0);
}

function wordText(path: string) {
  return execFileSync(
    process.execPath,
    [
      "scripts/run_python.mjs",
      "-c",
      "import sys,zipfile,xml.etree.ElementTree as E; z=zipfile.ZipFile(sys.argv[1]); print(''.join(E.fromstring(z.read('word/document.xml')).itertext()))",
      path,
    ],
    { encoding: "utf8" },
  );
}

test("direct sampling is recognized, saved without cards, confirmed and included in reception summaries", async ({
  page,
}, testInfo) => {
  await loginAndOpenEntry(page);
  const suffix = Date.now();
  const batchNo = `（Z2026001）20261022${suffix}`;
  const raw = `饲养需求批次号：${batchNo}\n锐竞采购单号：C20261022${suffix}\n供应商：广东南模\n品系：C57BL/6J\n数量：10\n接收日期：2026-10-22\n到货直接取材，无需饲养。`;
  await page.getByLabel("预约消息").fill(raw);
  await page.getByRole("button", { name: "本地识别", exact: true }).click();
  await expectDirectFields(page);
  await expect(page.getByLabel("IACUC 编号", { exact: true })).toHaveValue("Z2026001");
  await expect(page.getByLabel("数量（只）", { exact: true })).toHaveValue("10");
  await page.getByLabel("项目负责人", { exact: true }).fill("取材测试负责人");
  await page.getByLabel("实验负责人", { exact: true }).fill("取材测试实验负责人");
  await page.screenshot({ path: testInfo.outputPath("direct-entry.png"), fullPage: true, animations: "disabled" });
  const saving = page.waitForResponse(
    (r) => r.url().endsWith("/api/intake-batches") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存待接收批次", exact: true }).click();
  const response = await saving;
  expect(response.status()).toBe(201);
  const saved = await response.json();
  const id = saved.item.id;
  try {
    expect(saved.item).toMatchObject({
      intakePurpose: "direct_sampling",
      status: "pending_receipt",
      finalCardCount: 0,
      cards: [],
      roomName: "",
      endDate: "",
      husbandryDays: null,
    });
    expect(saved.placementTasks).toEqual([]);
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    const row = page.locator("tr", { hasText: batchNo });
    await expect(row).toContainText("待接收");
    await expect(row).toContainText("直接取材");
    await expect(row).toContainText("无需笼卡");
    await row.getByRole("checkbox", { name: `选择 ${batchNo}` }).check();
    await expect(page.getByRole("button", { name: "打印笼卡", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "标记已打印", exact: true })).toBeDisabled();
    const marking = page.waitForResponse((r) => r.url().endsWith("/api/intake-batches/confirm-receipt"));
    await page.getByRole("button", { name: "标记已接收", exact: true }).click();
    const confirmed = await marking;
    expect(confirmed.ok()).toBe(true);
    const result = await confirmed.json();
    expect(result.tasks).toEqual([]);
    await expect(row).toContainText("已接收");
    await expect(page.getByRole("button", { name: "标记已接收", exact: true })).toBeDisabled();
    const read = await page.request.get(`/api/intake-batches/${id}`);
    const data = await read.json();
    expect(data.item ?? data).toMatchObject({
      intakePurpose: "direct_sampling",
      status: "received",
      finalCardCount: 0,
      cards: [],
    });
    const repeated = await page.request.post("/api/intake-batches/confirm-receipt", { data: { ids: [id] } });
    expect((await repeated.json()).batches).toEqual([]);
    const filtered = await page.request.get(
      `/api/intake-batches?${new URLSearchParams({ columnFilters: JSON.stringify({ intakePurpose: ["direct_sampling"] }) })}`,
    );
    const filteredItems = (await filtered.json()).items;
    expect(filteredItems.some((item: { id: string }) => item.id === id)).toBe(true);
    expect(filteredItems.every((item: { intakePurpose: string }) => item.intakePurpose === "direct_sampling")).toBe(
      true,
    );
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "接收用途", exact: true })).toBeDisabled();
    await page
      .getByRole("dialog", { name: "编辑待接收批次", exact: true })
      .getByRole("button", { name: "关闭", exact: true })
      .click();

    await page.getByRole("button", { name: "导出汇总", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "接收汇总", exact: true });
    for (const label of ["开始日期", "结束日期"]) {
      await dialog.getByLabel(label, { exact: true }).click();
      await dialog.getByLabel(label, { exact: true }).fill("2026-10-22");
      await page.locator(".ant-picker-dropdown:visible").getByTitle("2026-10-22", { exact: true }).click();
      await expect(page.locator(".ant-picker-dropdown:visible")).toHaveCount(0);
    }
    const downloading = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "导出 Word", exact: true }).click();
    const download = await downloading;
    const docx = testInfo.outputPath("direct-reception-summary.docx");
    await download.saveAs(docx);
    const content = wordText(docx);
    expect(content).toContain(batchNo);
    expect(content).toContain("直接取材·无需笼卡·已接收");
    expect(content).toContain("数量：10只");
    expect(content).not.toContain("房间未填写");
  } finally {
    await page.request.delete(`/api/intake-batches/${id}`);
  }
});

test("AI direct-sampling recognition and manual purpose correction work across viewports", async ({
  page,
}, testInfo) => {
  await loginAndOpenEntry(page);
  await page.route("**/api/intake/ai-parse", (route) =>
    route.fulfill({
      json: {
        item: {
          intakePurpose: "direct_sampling",
          batchNo: "AI-DIRECT",
          supplier: "广东维通利华实验动物技术有限公司",
          iacuc: "Z2026001",
          quantity: 10,
          pi: "项目负责人",
          owner: "实验负责人",
          intakeDate: "2026-10-22",
        },
      },
    }),
  );
  await page.getByLabel("预约消息").fill("预约10只小鼠，到货直接取材，无需饲养。");
  await page.getByRole("button", { name: "AI识别", exact: true }).click();
  await expectDirectFields(page);
  await expect(page.getByLabel("接收人员", { exact: true })).toHaveValue("系统管理员");
  await expect(page.getByLabel("购买单位", { exact: true })).toHaveValue("广东维通利华");
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1180, height: 900 },
    { width: 760, height: 900 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expectDirectFields(page);
    await page.getByLabel("联系电话", { exact: true }).fill("020-12345678 / 13800000000");
    await page.getByRole("combobox", { name: "状态", exact: true }).scrollIntoViewIfNeeded();
    expect(await page.locator(".workspace-view").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`direct-${viewport.width}.png`), animations: "disabled" });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("combobox", { name: "接收用途", exact: true }).click();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("房间", { exact: true })).toBeVisible();
  await expect(page.getByLabel("饲养周期（天）", { exact: true })).toBeVisible();
  await expect(page.getByLabel("打印张数", { exact: true })).toHaveValue("2");
});

test("room administrators can receive direct-sampling batches without gaining housing or account permissions", async ({
  page,
  playwright,
  baseURL,
}) => {
  await loginAndOpenEntry(page);
  const username = `direct-receiver-${Date.now()}`;
  const createdUser = await page.request.post("/api/users", {
    data: {
      username,
      password: "direct-e2e-password",
      displayName: "直接取材接收测试员",
      role: "room_admin",
      roomIds: ["room-e2e-8014"],
    },
  });
  expect(createdUser.ok()).toBe(true);
  const { user } = await createdUser.json();
  const client = await playwright.request.newContext({ baseURL });
  let batchId = "";
  try {
    expect((await client.post("/api/auth/login", { data: { username, password: "direct-e2e-password" } })).ok()).toBe(
      true,
    );
    const response = await client.post("/api/intake-batches", {
      data: {
        item: {
          batchNo: `DIRECT-ROOM-${Date.now()}`,
          intakePurpose: "direct_sampling",
          status: "pending_receipt",
          supplier: "供应商",
          quantity: 5,
          iacuc: "Z2026001",
          pi: "项目负责人",
          owner: "实验负责人",
          intakeDate: "2026-10-22",
        },
      },
    });
    expect(response.status()).toBe(201);
    const { item } = await response.json();
    batchId = item.id;
    expect(item.cards).toEqual([]);
    const forged = await client.put(`/api/intake-batches/${batchId}`, {
      data: { item: { ...item, status: "received" }, expectedUpdatedAt: item.updatedAt },
    });
    expect(forged.status()).toBe(400);
    const marked = await client.post("/api/intake-batches/mark-printed", { data: { ids: [batchId] } });
    expect((await marked.json()).items).toEqual([]);
    const received = await client.post("/api/intake-batches/confirm-receipt", { data: { ids: [batchId] } });
    expect(received.ok()).toBe(true);
    const result = await received.json();
    expect(result.batches[0]).toMatchObject({ status: "received", intakePurpose: "direct_sampling", cards: [] });
    expect(result.tasks).toEqual([]);
    expect((await client.get("/api/users")).status()).toBe(403);
  } finally {
    if (batchId) await page.request.delete(`/api/intake-batches/${batchId}`);
    await page.request.delete(`/api/users/${user.id}`);
    await client.dispose();
  }
});
