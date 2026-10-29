import type { Page } from "@playwright/test";
import { ensureTestInfrastructure, expect, openNavigationEntry, test } from "./fixtures";

test("intake lists summaries before room data, loads edit detail on demand and rejects stale print", async ({
  page,
}) => {
  expect((await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } })).ok()).toBe(
    true,
  );
  await page.goto("/app");
  await ensureTestInfrastructure(page);
  const suffix = `${Date.now()}`;
  const id = `summary-read-${suffix}`;
  const batchNo = `SUMMARY-${suffix}`;
  const response = await page.request.post("/api/intake-batches", {
    data: {
      item: {
        id,
        batchNo,
        iacuc: "Z2026001",
        supplier: "测试供应商",
        pi: "测试负责人",
        owner: "测试实验负责人",
        species: "mouse",
        quantity: 24,
        husbandryDays: 28,
        roomName: "8014",
        finalCardCount: 14,
        intakeDate: "2099-10-21",
        status: "pending_print",
        cards: [],
        rawMessage: "长预约内容".repeat(3000),
        recognition: { extractedText: "来源文本".repeat(3000), warnings: [], fieldSources: { quantity: "预约图片" } },
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  let details = 0;
  let prints = 0;
  const popups: Page[] = [];
  page.on("popup", (popup) => popups.push(popup));
  let roomsDone = false;
  let detailAttempts = 0;
  try {
    await page.route("**/api/rooms", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue();
      roomsDone = true;
    });
    await page.route(`**/api/intake-batches/${id}`, async (route) => {
      details += 1;
      if (detailAttempts++ < 2) return route.fulfill({ status: 503, json: { error: "详情暂不可用" } });
      return route.continue();
    });
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/intake-batches/print-data") prints += 1;
    });
    const summaryResponse = page.waitForResponse((result) => {
      const url = new URL(result.url());
      return url.pathname === "/api/intake-batches" && url.searchParams.get("view") === "summary";
    });
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    const list = page.getByRole("region", { name: "待接收批次列表" });
    await expect(list.getByText(batchNo, { exact: true })).toBeVisible();
    const summary = (await (await summaryResponse).json()) as { items: Array<Record<string, unknown>> };
    const item = summary.items.find((entry) => entry.id === id);
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty("cards");
    expect(item).not.toHaveProperty("recognition");
    expect(item).not.toHaveProperty("rawMessage");
    expect(roomsDone).toBe(false);
    expect(details).toBe(0);
    expect(prints).toBe(0);
    await expect.poll(() => roomsDone).toBe(true);
    const row = page.getByRole("row").filter({ hasText: batchNo });
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "编辑待接收批次" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("批次详情加载失败")).toBeVisible();
    await dialog.getByRole("button", { name: "重新加载", exact: true }).click();
    await expect(dialog.getByLabel("批次号", { exact: true })).toHaveValue(batchNo);
    expect(details).toBe(3);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await row.getByRole("checkbox", { name: `选择 ${batchNo}` }).check();
    const full = await (await page.request.get(`/api/intake-batches/${id}`)).json();
    const changed = await page.request.put(`/api/intake-batches/${id}`, {
      data: { item: { ...full.item, notes: "版本更新" }, expectedUpdatedAt: full.item.updatedAt },
    });
    expect(changed.ok(), await changed.text()).toBe(true);
    const conflict = page.waitForResponse(
      (result) => new URL(result.url()).pathname === "/api/intake-batches/print-data",
    );
    await page.getByRole("button", { name: "打印笼卡", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "补齐空白笼卡" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "直接打印", exact: true }).click();
    expect((await conflict).status()).toBe(409);
    await expect(page.getByText(/所选批次已更新/)).toBeVisible();
    expect(prints).toBe(1);
    await expect.poll(() => popups.length > 0 && popups.every((popup) => popup.isClosed())).toBe(true);
  } finally {
    await page.request.delete(`/api/intake-batches/${id}`);
  }
});
