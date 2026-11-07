import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import type { IntakeBatch, IntakeReviewPreview } from "../../src/contracts/intake";
import { ensureTestInfrastructure, expect, openIntakeEntry, test } from "./fixtures";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAD0lEQVR4nGP4TwAwjAwFAIS1/wF0QtmAAAAAAElFTkSuQmCC";
const bytes = Buffer.from(png, "base64");
async function setup(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeHidden();
  expect((await (await page.request.get("/api/health")).json()).database).toContain("cageledger-e2e-");
  await ensureTestInfrastructure(page);
  await openIntakeEntry(page);
  await page.route("**/api/intake/standardize-strain", (route) => route.fulfill({ json: { item: "C57BL/6J" } }));
}
async function original(page: Page, image: boolean, overrides: Partial<IntakeBatch> = {}) {
  const suffix = `${Date.now()}`;
  const item: IntakeBatch = {
    id: `review-${suffix}`,
    intakePurpose: "housing",
    purchaseOrderNo: `C${suffix}`,
    orderNo: `DC${suffix}01`,
    batchNo: `(Z2026001)${suffix}`,
    iacuc: "Z2026001",
    supplier: "药康",
    species: "mouse",
    strainRaw: "C57BL/6J",
    strainStandard: "C57BL/6J",
    specification: "6周龄",
    sex: "雌性",
    quantity: 24,
    finalCardCount: 4,
    suggestedAnimalsPerCage: 6,
    suggestedCardCount: 4,
    confirmedCardCount: 0,
    remainingCardCount: 4,
    cards: [],
    receipts: [],
    roomName: "8014",
    roomMatched: true,
    pi: "合成项目负责人",
    owner: "合成实验负责人",
    receiverName: "合成接收人",
    vetPhone: "",
    project: "",
    rawMessage: "原预约合成原文",
    intakeDate: "2026-11-06",
    husbandryDays: null,
    husbandryMonths: 2,
    endDate: "",
    notes: "",
    status: "pending_print",
    updatedAt: "",
    ...overrides,
  };
  const response = await page.request.post("/api/intake-batches", {
    data: {
      item,
      ...(image ? { recognitionImages: [{ name: "原预约.png", dataUrl: `data:image/png;base64,${png}` }] } : {}),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).item as IntakeBatch;
}
async function saved(page: Page, id: string) {
  const response = await page.request.get(`/api/intake-batches/${encodeURIComponent(id)}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).item as IntakeBatch;
}
function text(item: IntakeBatch) {
  return `饲养需求批次号：${item.batchNo}\n采购单号：${item.purchaseOrderNo}\n订单编号：${item.orderNo}\n品系：C57BL/6J\n规格：6周龄\n数量：24\n性别：雌性\n供应商：药康\n饲养房间：8014\n预约送货日期：2026-11-06\n饲养周期：2个月`;
}
function recognized(item: IntakeBatch, overrides: Partial<IntakeBatch> = {}) {
  const fields: Partial<IntakeBatch> = { ...item };
  delete fields.id;
  delete fields.updatedAt;
  delete fields.recognition;
  return { ...fields, ...overrides };
}
async function ai(page: Page, item: IntakeBatch, image: boolean, overrides: Partial<IntakeBatch> = {}) {
  await page.route("**/api/intake/ai-parse", (route) =>
    route.fulfill({
      json: {
        item: recognized(item, overrides),
        recognition: {
          extractedText: "合成来源：24只 C57BL/6J 6周龄",
          warnings: [],
          fieldSources: {},
          ...(image
            ? { inputImages: [{ name: "本次.png", sha256: createHash("sha256").update(bytes).digest("hex") }] }
            : {}),
        },
      },
    }),
  );
  if (image)
    await page
      .getByLabel("预约图片文件", { exact: true })
      .setInputFiles({ name: "本次.png", mimeType: "image/png", buffer: bytes });
  await page.getByRole("button", { name: "AI识别", exact: true }).click();
}
const review = (page: Page) => page.getByRole("dialog", { name: "核对已有预约", exact: true });

for (const [incomingImage, originalImage] of [
  [false, true],
  [true, true],
  [true, false],
  [false, false],
]) {
  test(`${incomingImage ? "image" : "text"} to ${originalImage ? "image" : "text"} exact review ends without changing the registered appointment`, async ({
    page,
  }, info) => {
    await setup(page);
    const item = await original(page, originalImage);
    const writes: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        (request.method() === "POST" && path === "/api/intake-batches") ||
        (request.method() === "PUT" && /^\/api\/intake-batches\/[^/]+$/.test(path))
      )
        writes.push(request.url());
    });
    await page.getByLabel("预约消息", { exact: true }).fill(text(item));
    if (!incomingImage && originalImage) await page.getByRole("button", { name: "本地识别", exact: true }).click();
    else await ai(page, item, incomingImage);
    const dialog = review(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "已登记，结束本次录入", exact: true })).toBeEnabled();
    await page.screenshot({ path: info.outputPath("unified-review-initial.png"), animations: "disabled" });
    await dialog.getByText("原预约原文与图片", { exact: true }).click();
    await expect(dialog).toContainText("原预约合成原文");
    if (originalImage)
      await expect(dialog.getByRole("img", { name: "原预约图片：原预约.png", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("unified-reservation-review.png"), animations: "disabled" });
    if (incomingImage && originalImage) {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1180, height: 820 },
        { width: 760, height: 900 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        await expect(dialog).toBeVisible();
        const geometry = await dialog.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const body = element.querySelector<HTMLElement>(".modal-shell-body")!;
          return {
            left: box.left,
            right: box.right,
            viewport: innerWidth,
            bodyOverflow: body.scrollWidth > body.clientWidth + 1,
            pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          };
        });
        expect(geometry.left).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
        expect(geometry.bodyOverflow).toBe(false);
        expect(geometry.pageOverflow).toBe(false);
        await expect(dialog.getByRole("button", { name: "已登记，结束本次录入", exact: true })).toBeInViewport();
        await page.screenshot({
          path: info.outputPath(`unified-review-${viewport.width}x${viewport.height}.png`),
          animations: "disabled",
        });
      }
    }
    await dialog.getByRole("button", { name: "已登记，结束本次录入", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel("预约消息", { exact: true })).toHaveValue("");
    expect(writes).toEqual([]);
    expect(await saved(page, item.id)).toEqual(item);
    if (originalImage) expect(await (await page.request.get(item.recognition!.images![0].url)).body()).toEqual(bytes);
  });
}

test("a conflicting animal quantity returns to the same review on save and allows editing the original in place", async ({
  page,
}) => {
  await setup(page);
  const item = await original(page, true);
  const incomingText = text(item).replace("数量：24", "数量：99");
  await page.getByLabel("预约消息", { exact: true }).fill(incomingText);
  await ai(page, item, false, { quantity: 99 });
  const dialog = review(page);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("row").filter({ has: page.getByRole("cell", { name: "动物数量", exact: true }) }),
  ).toContainText("99");
  await expect(dialog.getByRole("button", { name: "确认补充原预约", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "返回修改本次草稿", exact: true }).click();
  await expect(page.getByLabel("预约消息", { exact: true })).toHaveValue(incomingText);
  await page.getByRole("button", { name: "保存待接收批次", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认为另一预约，另行保存", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "在当前页面编辑原预约", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("预约消息", { exact: true })).toHaveValue(item.rawMessage);
  await expect(page.getByRole("heading", { name: "编辑接收笼卡", exact: true })).toBeVisible();
  expect((await saved(page, item.id)).updatedAt).toBe(item.updatedAt);
});

test("explicit supplementation rechecks a concurrent version and retains the original images and identity", async ({
  page,
}) => {
  await setup(page);
  const item = await original(page, true, { intakeDate: "" });
  const image = item.recognition!.images![0];
  await page.getByLabel("预约消息", { exact: true }).fill(text(item));
  await ai(page, item, false, { intakeDate: "2026-11-06" });
  const dialog = review(page);
  await expect(dialog.getByRole("button", { name: "确认补充原预约", exact: true })).toBeEnabled();
  const concurrent = await page.request.put(`/api/intake-batches/${item.id}`, {
    data: { item: { ...item, notes: "其他同事已核对" }, expectedUpdatedAt: item.updatedAt },
  });
  expect(concurrent.ok(), await concurrent.text()).toBe(true);
  await dialog.getByRole("button", { name: "确认补充原预约", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "重新核对", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认补充原预约", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "重新核对", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "确认补充原预约", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "确认补充原预约", exact: true }).click();
  await expect(dialog).toBeHidden();
  const updated = await saved(page, item.id);
  expect(updated).toMatchObject({
    id: item.id,
    quantity: 24,
    sex: "雌性",
    intakeDate: "2026-11-06",
    notes: "其他同事已核对",
    cards: item.cards,
  });
  expect(updated.recognition!.images).toEqual(item.recognition!.images);
  expect(updated.recognition!.recognitionRounds?.length).toBeGreaterThan(0);
  expect(await (await page.request.get(image.url)).body()).toEqual(bytes);
  const preview = await page.request.post("/api/intake-batches/recognition-preview", {
    data: { reviewVersion: 2, item: recognized(updated) },
  });
  expect(((await preview.json()) as IntakeReviewPreview).items[0].item.id).toBe(item.id);
});
