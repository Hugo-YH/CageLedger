import type { IntakeBatch, IntakeRecognitionMergePreview } from "../../src/contracts/intake";
import { ensureTestInfrastructure, expect, openIntakeEntry, openNavigationEntry, test } from "./fixtures";
import type { Page } from "@playwright/test";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAD0lEQVR4nGP4TwAwjAwFAIS1/wF0QtmAAAAAAElFTkSuQmCC";

async function setup(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeHidden();
  const health = await page.request.get("/api/health");
  expect((await health.json()).database).toContain("cageledger-e2e-");
  await ensureTestInfrastructure(page);
  await openIntakeEntry(page);
}

async function original(page: Page, suffix: string, overrides: Partial<IntakeBatch> = {}) {
  const item: IntakeBatch = {
    species: "mouse",
    roomMatched: true,
    receiverName: "原预约接收人",
    vetPhone: "",
    project: "",
    notes: "",
    suggestedAnimalsPerCage: 6,
    suggestedCardCount: 4,
    confirmedCardCount: 0,
    remainingCardCount: 4,
    receipts: [],
    cards: [],
    updatedAt: "",
    id: `merge-${suffix}`,
    purchaseOrderNo: `C${suffix}`,
    batchNo: `(Z2026001)${suffix}`,
    iacuc: "Z2026001",
    supplier: "图片供应商",
    strainRaw: "C57BL/6",
    strainStandard: "C57BL/6",
    quantity: 24,
    sex: "雌性",
    finalCardCount: 4,
    roomName: "8014",
    pi: "图片项目负责人",
    owner: "图片实验负责人",
    rawMessage: "已保存的图片预约原文",
    intakeDate: "",
    husbandryDays: null,
    husbandryMonths: 2,
    endDate: "",
    status: "pending_print",
    recognition: {
      extractedText: "原图24只雌性，4笼，饲养2个月",
      warnings: [],
      fieldSources: { quantity: "原图24只" },
    },
    ...overrides,
  };
  const response = await page.request.post("/api/intake-batches", {
    data: { item, recognitionImages: [{ name: "原预约.png", dataUrl: `data:image/png;base64,${png}` }] },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).item as IntakeBatch;
}

function message(item: IntakeBatch) {
  return `饲养需求批次号：${item.batchNo}\n锐竞采购单号：${item.purchaseOrderNo}\n预约送货日期：2026-11-06\n数量：99\n性别：雄性`;
}

async function saved(page: Page, id: string) {
  const response = await page.request.get(`/api/intake-batches/${encodeURIComponent(id)}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).item as IntakeBatch;
}

for (const recognition of ["本地识别", "AI识别"]) {
  test(`${recognition} offers a real image-first merge and updates one original with retained image bytes`, async ({
    page,
  }, info) => {
    await setup(page);
    const item = await original(page, `${Date.now()}`);
    const imageUrl = item.recognition!.images![0].url;
    const imageBefore = await (await page.request.get(imageUrl)).body();
    const text = message(item);
    if (recognition === "AI识别")
      await page.route("**/api/intake/ai-parse", (route) =>
        route.fulfill({
          json: {
            item: {
              batchNo: item.batchNo,
              purchaseOrderNo: item.purchaseOrderNo,
              quantity: 99,
              sex: "雄性",
              intakeDate: "2026-11-06",
              supplier: "文字供应商",
              iacuc: "Z2026001",
            },
          },
        }),
      );
    await page.getByLabel("预约消息", { exact: true }).fill(text);
    await page.getByRole("button", { name: recognition, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "核对已有图片预约", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("img", { name: "原预约图片：原预约.png", exact: true })).toBeVisible();
    const dateRow = dialog.getByRole("row").filter({ has: page.getByRole("cell", { name: "接收日期", exact: true }) });
    await expect(dateRow).toContainText("2026-11-06");
    const quantityRow = dialog
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: "动物数量", exact: true }) });
    await expect(quantityRow).toContainText("99");
    expect((await saved(page, item.id)).updatedAt).toBe(item.updatedAt);
    await page.screenshot({ path: info.outputPath("recognition-merge-preview.png"), animations: "disabled" });
    await dialog.getByRole("button", { name: "确认更新原预约", exact: true }).click();
    await expect(dialog).toBeHidden();
    const updated = await saved(page, item.id);
    expect(updated).toMatchObject({
      id: item.id,
      quantity: 24,
      sex: "雌性",
      supplier: "图片供应商",
      status: "pending_print",
      intakeDate: "2026-11-06",
      endDate: "2027-01-06",
      husbandryDays: 61,
      husbandryMonths: 2,
      pi: "图片项目负责人",
      owner: "图片实验负责人",
    });
    expect(updated.recognition!.images).toEqual(item.recognition!.images);
    expect(updated.rawMessage).toContain(text);
    expect(await (await page.request.get(imageUrl)).body()).toEqual(imageBefore);
    const matching = await page.request.post("/api/intake-batches/recognition-preview", {
      data: { item: { ...item, rawMessage: text } },
    });
    expect(((await matching.json()) as IntakeRecognitionMergePreview).total).toBe(1);
    const audits = await page.request.get("/api/audit-events?limit=100&offset=0");
    expect(
      (await audits.json()).items.filter(
        (event: { entityId: string; action: string }) =>
          event.entityId === item.id && event.action === "intake_batch.recognition_merged",
      ),
    ).toHaveLength(1);
  });
}

test("association conflicts cannot merge and a stale preview keeps the text until rechecked", async ({ page }) => {
  await setup(page);
  const item = await original(page, `${Date.now()}`);
  await page.getByLabel("预约消息", { exact: true }).fill(message({ ...item, purchaseOrderNo: "C2026119999999" }));
  await page.getByRole("button", { name: "本地识别", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "核对已有图片预约", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认更新原预约", exact: true })).toHaveCount(0);
  await expect(dialog).toContainText("已对应其他编号");
  await dialog.getByRole("button", { name: "取消合并，保留草稿", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("预约消息", { exact: true })).toHaveValue(
    message({ ...item, purchaseOrderNo: "C2026119999999" }),
  );
  await page.getByLabel("预约消息", { exact: true }).fill(message(item));
  await page.getByRole("button", { name: "本地识别", exact: true }).click();
  await expect(dialog).toBeVisible();
  const concurrent = await page.request.put(`/api/intake-batches/${item.id}`, {
    data: {
      item: { ...item, notes: "另一位同事已核对" },
      expectedUpdatedAt: item.updatedAt,
    },
  });
  expect(concurrent.ok(), await concurrent.text()).toBe(true);
  await dialog.getByRole("button", { name: "确认更新原预约", exact: true }).click();
  await expect(dialog).toContainText("已有预约已更新");
  await expect(page.getByLabel("预约消息", { exact: true })).toHaveValue(message(item));
  await dialog.getByRole("button", { name: "重新匹配", exact: true }).click();
  await expect(dialog.getByText("已有预约已更新", { exact: false })).toHaveCount(0);
  await dialog.getByRole("button", { name: "确认更新原预约", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await saved(page, item.id)).notes).toBe("另一位同事已核对");
});

test("standard batch-number spacing matches the saved image original through both identifiers and batch-only lookup", async ({
  page,
}, info) => {
  await setup(page);
  const room = await page.request.post("/api/rooms", {
    data: {
      item: {
        id: "room-e2e-8101-spacing",
        name: "8101",
        area: "E2E",
        roomManager: "E2E 房间管理员",
        facility: "zhujiang",
        defaultSpecies: "mouse",
        defaultBillingItem: "mouse_standard",
        defaultCustomerType: "internal",
        defaultAnimalCount: 1,
      },
    },
  });
  expect(room.ok(), await room.text()).toBe(true);
  await page.reload();
  await openIntakeEntry(page);
  const originalBatchNo = "(Z2025170)  2026102902";
  const savedBatchNo = "（Z2025170）2026102902";
  const purchaseOrderNo = "C2026110229486";
  const item = await original(page, `spacing-${Date.now()}`, {
    batchNo: originalBatchNo,
    purchaseOrderNo,
    iacuc: "Z2025170",
    roomName: "8101",
    quantity: 6,
    finalCardCount: 1,
    suggestedCardCount: 1,
    remainingCardCount: 1,
    recognition: {
      extractedText: "原图6只，房间8101",
      warnings: [],
      fieldSources: { quantity: "原图6只", roomName: "原图8101" },
    },
  });
  expect(item.batchNo).toBe(savedBatchNo);
  const image = item.recognition!.images![0];
  const imageBefore = await (await page.request.get(image.url)).body();

  const batchOnly = await page.request.post("/api/intake-batches/recognition-preview", {
    data: {
      item: {
        batchNo: "(Z2025170)2026102902",
        intakeDate: "2026-11-11",
        rawMessage: "饲养需求批次号为(Z2025170) 2026102902\n进驻日期：2026-11-11",
      },
    },
  });
  expect(batchOnly.ok(), await batchOnly.text()).toBe(true);
  const batchOnlyPreview = (await batchOnly.json()) as IntakeRecognitionMergePreview;
  expect(batchOnlyPreview.total).toBe(1);
  expect(batchOnlyPreview.items[0]).toMatchObject({
    item: { id: item.id, batchNo: savedBatchNo },
    matchedFields: ["batchNo"],
    classification: "batch_only",
    canMerge: true,
  });

  const text =
    "经审核采购申请单号为C2026110229486，饲养需求批次号为(Z2025170) 2026102902\n" +
    "供应商：广东药康\n品系：C57\n数量：6\n饲养房间：8101\n进驻日期： 2026-11-11";
  await page.getByLabel("预约消息", { exact: true }).fill(text);
  const previewResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/intake-batches/recognition-preview" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "本地识别", exact: true }).click();
  const response = await previewResponse;
  expect(response.ok(), await response.text()).toBe(true);
  const preview = (await response.json()) as IntakeRecognitionMergePreview;
  expect(preview.total).toBe(1);
  expect(preview.items[0]).toMatchObject({ item: { id: item.id }, classification: "same_pair", canMerge: true });
  expect(preview.items[0].matchedFields).toHaveLength(2);
  expect(preview.items[0].matchedFields).toEqual(expect.arrayContaining(["purchaseOrderNo", "batchNo"]));
  const dialog = page.getByRole("dialog", { name: "核对已有图片预约", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("匹配：采购单号、批次号");
  const confirm = dialog.getByRole("button", { name: "确认更新原预约", exact: true });
  await expect(confirm).toBeEnabled();
  expect((await saved(page, item.id)).updatedAt).toBe(item.updatedAt);
  await page.screenshot({ path: info.outputPath("spacing-merge-preview.png"), animations: "disabled" });
  await confirm.click();
  await expect(dialog).toBeHidden();
  const updated = await saved(page, item.id);
  expect(updated).toMatchObject({
    id: item.id,
    batchNo: savedBatchNo,
    purchaseOrderNo,
    quantity: 6,
    roomName: "8101",
    intakeDate: "2026-11-11",
  });
  expect(updated.rawMessage).toContain(item.rawMessage);
  expect(updated.rawMessage).toContain(text);
  expect(updated.recognition!.images).toEqual(item.recognition!.images);
  expect(await (await page.request.get(image.url)).body()).toEqual(imageBefore);
  const matching = await page.request.post("/api/intake-batches/recognition-preview", {
    data: { item: { batchNo: "(Z2025170)2026102902", purchaseOrderNo, rawMessage: text } },
  });
  expect(matching.ok(), await matching.text()).toBe(true);
  const afterPreview = (await matching.json()) as IntakeRecognitionMergePreview;
  expect(afterPreview.total).toBe(1);
  expect(afterPreview.items[0].item.id).toBe(item.id);
});

test("purchase requests and full orders are separately saved, visible and checked during image merge", async ({
  page,
}, info) => {
  await setup(page);
  const purchase = "C2026080333568";
  const order = "DC202608033356801";
  const item = await original(page, `separate-orders-${Date.now()}`, { purchaseOrderNo: order });
  expect(item).toMatchObject({ purchaseOrderNo: purchase, orderNo: order });
  const image = item.recognition!.images![0];
  const imageBefore = await (await page.request.get(image.url)).body();
  const text = message(item);
  await page.getByLabel("预约消息", { exact: true }).fill(text);
  await page.getByRole("button", { name: "本地识别", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "核对已有图片预约", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(purchase);
  await expect(dialog).toContainText(order);
  await dialog.getByRole("button", { name: "确认更新原预约", exact: true }).click();
  await expect(dialog).toBeHidden();
  const updated = await saved(page, item.id);
  expect(updated).toMatchObject({ id: item.id, purchaseOrderNo: purchase, orderNo: order, intakeDate: "2026-11-06" });
  expect(updated.rawMessage).toContain(item.rawMessage);
  expect(updated.recognition!.images).toEqual(item.recognition!.images);
  expect(await (await page.request.get(image.url)).body()).toEqual(imageBefore);

  await page.getByLabel("预约消息", { exact: true }).fill(`${text}\n订单编号：${order.slice(0, -2)}07`);
  await page.getByRole("button", { name: "本地识别", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("已对应其他编号");
  await expect(dialog.getByRole("button", { name: "确认更新原预约", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "取消合并，保留草稿", exact: true }).click();

  await openNavigationEntry(page, "笼卡管理", "待接收批次");
  const row = page.getByRole("row").filter({ hasText: item.batchNo });
  await expect(row).toContainText(purchase);
  await expect(row).toContainText(order);
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByLabel("采购单号", { exact: true })).toHaveValue(purchase);
  await expect(page.getByLabel("订单编号", { exact: true })).toHaveValue(order);
  await page.screenshot({ path: info.outputPath("separate-purchase-and-order.png"), animations: "disabled" });
});
