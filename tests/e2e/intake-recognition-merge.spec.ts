import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import type { IntakeBatch, IntakeRecognitionEvidence, IntakeReviewPreview } from "../../src/contracts/intake";
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
async function ai(
  page: Page,
  item: IntakeBatch,
  image: boolean,
  overrides: Partial<IntakeBatch> = {},
  evidence: Partial<IntakeRecognitionEvidence> = {},
) {
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
          ...evidence,
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
      const footer = dialog.locator(".modal-shell-actions");
      const editSaved = footer.getByRole("button", { name: "编辑已保存的预约", exact: true });
      await footer.getByRole("button", { name: "返回本次录入", exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(editSaved).toBeFocused();
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
          const materials = element.querySelector<HTMLElement>('[aria-label="预约来源材料"]')!;
          const row = materials.querySelector<HTMLElement>(".ant-row")!;
          const columns = [...row.children].map((column) => {
            const bounds = column.getBoundingClientRect();
            const style = getComputedStyle(column);
            return {
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              flex: style.flex,
              minWidth: style.minWidth,
            };
          });
          const actions = element.querySelector<HTMLElement>(".modal-shell-actions")!;
          return {
            left: box.left,
            right: box.right,
            viewport: innerWidth,
            bodyOverflow: body.scrollWidth > body.clientWidth + 1,
            pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
            sources: { display: getComputedStyle(row).display, wrap: getComputedStyle(row).flexWrap, columns },
            bodyOverflowY: getComputedStyle(body).overflowY,
            footer: { display: getComputedStyle(actions).display, position: getComputedStyle(actions).position },
          };
        });
        expect(geometry.left).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
        expect(geometry.bodyOverflow).toBe(false);
        expect(geometry.pageOverflow).toBe(false);
        expect(geometry.sources.display).toBe("flex");
        expect(geometry.sources.columns).toHaveLength(2);
        const [savedSource, incomingSource] = geometry.sources.columns;
        if (viewport.width >= 768) {
          expect(Math.abs(savedSource.top - incomingSource.top)).toBeLessThanOrEqual(1);
          expect(incomingSource.left).toBeGreaterThan(savedSource.left);
        } else {
          expect(incomingSource.top).toBeGreaterThan(savedSource.top);
          expect(Math.abs(savedSource.left - incomingSource.left)).toBeLessThanOrEqual(1);
        }
        expect(geometry.bodyOverflowY).toBe("auto");
        expect(geometry.footer).toEqual({ display: "flex", position: "sticky" });
        await expect(editSaved).toBeFocused();
        await expect(editSaved).toBeInViewport();
        await expect(footer.getByRole("button", { name: "返回本次录入", exact: true })).toBeInViewport();
        await expect(dialog.getByRole("button", { name: "已登记，结束本次录入", exact: true })).toBeInViewport();
        await info.attach(`review-layout-${viewport.width}x${viewport.height}`, {
          body: JSON.stringify(
            {
              viewport,
              geometry,
              layoutOwner: "Ant Row/Col; src/styles/features/modal.css",
              keyboardFocus: "edit-saved",
            },
            null,
            2,
          ),
          contentType: "application/json",
        });
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

test("a text-only appointment with conflicting quantity returns to the same review and allows editing the original", async ({
  page,
}) => {
  await setup(page);
  const item = await original(page, false);
  const incomingText = text(item).replace("数量：24", "数量：99");
  await page.getByLabel("预约消息", { exact: true }).fill(incomingText);
  await ai(page, item, false, { quantity: 99 });
  const dialog = review(page);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("row").filter({ has: page.getByRole("cell", { name: "动物数量", exact: true }) }),
  ).toContainText("99");
  await expect(dialog.getByRole("button", { name: "确认补充原预约", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "返回本次录入", exact: true }).click();
  await expect(page.getByLabel("预约消息", { exact: true })).toHaveValue(incomingText);
  await page.getByRole("button", { name: "保存待接收批次", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认为另一预约，另行保存", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "编辑已保存的预约", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("预约消息", { exact: true })).toHaveValue(item.rawMessage);
  await expect(page.getByRole("heading", { name: "编辑接收笼卡", exact: true })).toBeVisible();
  expect((await saved(page, item.id)).updatedAt).toBe(item.updatedAt);
});

test("later local text without sex supplements the saved image appointment while retaining image values", async ({
  page,
}, info) => {
  await setup(page);
  const room = await page.request.post("/api/rooms", {
    data: { item: { id: "room-review-8103", name: "8103", facility: "zhujiang" } },
  });
  expect(room.ok(), await room.text()).toBe(true);
  await page.reload();
  const item = await original(page, true, {
    purchaseOrderNo: "C2026110540168",
    orderNo: "",
    batchNo: "（Z2024020）2026110301",
    iacuc: "Z2024020",
    supplier: "广东药康",
    specification: "6-8w",
    sex: "雄性",
    quantity: 15,
    finalCardCount: 3,
    roomName: "8103",
    intakeDate: "2026-11-11",
    endDate: "2026-12-12",
    husbandryDays: 31,
    husbandryMonths: null,
  });
  const incomingText =
    "锐竞采购申请单号为C2026110540168，饲养需求批次号为(Z2024020) 2026110301\n" +
    "供应商：广东药康\n品系：C57BL/6J\n数量：15只(3笼）\n饲养房间：8103\n进驻日期：2026年11月11日";
  await page.getByLabel("预约消息", { exact: true }).fill(incomingText);
  await page.getByRole("button", { name: "本地识别", exact: true }).click();
  const dialog = review(page);
  await expect(dialog.getByRole("button", { name: "确认补充原预约", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "已登记，结束本次录入", exact: true })).toHaveCount(0);
  const sexRow = dialog.getByRole("row").filter({ has: page.getByRole("cell", { name: "性别", exact: true }) });
  await expect(sexRow.getByRole("cell").nth(2)).toContainText("雌性/雄性");
  await expect(sexRow.getByRole("cell").nth(2)).toContainText("未确认占位");
  await expect(sexRow.getByRole("cell").nth(3)).toHaveText("雄性");
  await expect(
    dialog
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: "规格", exact: true }) })
      .getByRole("cell")
      .nth(3),
  ).toHaveText("6-8w");
  expect(await saved(page, item.id)).toEqual(item);
  await page.screenshot({ path: info.outputPath("saved-image-text-supplement.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "返回本次录入", exact: true }).click();
  await expect(page.getByLabel("预约消息", { exact: true })).toHaveValue(incomingText);
  await page.getByRole("button", { name: "本地识别", exact: true }).click();
  await dialog.getByRole("button", { name: "确认补充原预约", exact: true }).click();
  await expect(dialog).toBeHidden();
  const updated = await saved(page, item.id);
  for (const field of [
    "id",
    "quantity",
    "sex",
    "specification",
    "roomName",
    "intakeDate",
    "endDate",
    "husbandryDays",
    "cards",
    "status",
  ] as const)
    expect(updated[field], field).toEqual(item[field]);
  expect(updated.recognition!.images).toEqual(item.recognition!.images);
  expect(updated.recognition!.recognitionRounds!.at(-1)!.rawMessage).toBe(incomingText);
  expect(updated.rawMessage).toContain(incomingText);
});

test("late arrival shows the retained period and extended end before saving", async ({ page }, info) => {
  await setup(page);
  const item = await original(page, true, {
    intakeDate: "",
    endDate: "2027-01-04",
    husbandryDays: 61,
    husbandryMonths: null,
  });
  await page
    .getByLabel("预约消息", { exact: true })
    .fill(
      `饲养需求批次号：${item.batchNo}\n采购单号：${item.purchaseOrderNo}\n订单编号：${item.orderNo}\n进驻日期：2026-11-11`,
    );
  await ai(page, item, false, { intakeDate: "2026-11-11", endDate: "", husbandryDays: null, husbandryMonths: null });
  const dialog = review(page);
  const endRow = dialog.getByRole("row").filter({ has: page.getByRole("cell", { name: "结束日期", exact: true }) });
  const daysRow = dialog.getByRole("row").filter({ has: page.getByRole("cell", { name: "饲养天数", exact: true }) });
  await expect(endRow).toContainText("原值 2027-01-04 → 合并后 2027-01-11");
  await expect(endRow).toContainText("2026-11-11 + 保留 61 天 = 新结束日 2027-01-11");
  await expect(endRow).toContainText("联动计算");
  await expect(daysRow).toContainText("原值 61 → 合并后 61");
  await expect(daysRow).toContainText("保留原值");
  await expect(daysRow).not.toContainText("本次缺失");
  expect(await saved(page, item.id)).toEqual(item);
  await page.screenshot({ path: info.outputPath("arrival-period-calculation.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "确认补充原预约", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await saved(page, item.id)).toMatchObject({
    intakeDate: "2026-11-11",
    endDate: "2027-01-11",
    husbandryDays: 61,
    cards: item.cards,
  });
});

test("field choices resolve a text conflict and save the recalculated period in place", async ({ page }, info) => {
  await setup(page);
  const item = await original(page, false, {
    sex: "雌性",
    intakeDate: "2026-11-04",
    endDate: "2027-01-04",
    husbandryDays: 61,
    husbandryMonths: null,
  });
  const incomingText = `饲养需求批次号：${item.batchNo}\n采购单号：${item.purchaseOrderNo}\n订单编号：${item.orderNo}\n性别：雄性\n进驻日期：2026-11-11`;
  await page.getByLabel("预约消息", { exact: true }).fill(incomingText);
  await ai(page, item, false, {
    sex: "雄性",
    intakeDate: "2026-11-11",
    endDate: "",
    husbandryDays: null,
    husbandryMonths: null,
  });
  const dialog = review(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认补充原预约", exact: true })).toHaveCount(0);
  await dialog.getByRole("radiogroup", { name: "性别取值", exact: true }).getByText("雄性", { exact: true }).click();
  await expect(
    dialog
      .getByRole("radiogroup", { name: "接收日期取值", exact: true })
      .getByRole("radio", { name: "2026-11-11", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("radiogroup", { name: "接收日期取值", exact: true })
    .getByText("2026-11-11", { exact: true })
    .click();
  const confirm = dialog.getByRole("button", { name: "确认补充原预约", exact: true });
  await expect(confirm).toBeEnabled();
  const end = dialog.getByRole("row").filter({ has: page.getByRole("cell", { name: "结束日期", exact: true }) });
  await expect(end).toContainText("原值 2027-01-04 → 合并后 2027-01-11");
  await expect(end).toContainText("保留 61 天");
  await expect(
    dialog.getByRole("radiogroup", { name: "性别取值", exact: true }).getByRole("radio", { name: "雄性", exact: true }),
  ).toBeChecked();
  expect(await saved(page, item.id)).toEqual(item);
  await page.screenshot({ path: info.outputPath("field-resolution-preview.png"), animations: "disabled" });
  const write = page.waitForRequest(
    (request) => request.method() === "PUT" && new URL(request.url()).pathname === `/api/intake-batches/${item.id}`,
  );
  await confirm.click();
  expect((await write).postDataJSON().recognitionMerge.resolutions).toEqual({
    sex: "incoming",
    intakeDate: "incoming",
  });
  await expect(dialog).toBeHidden();
  expect(await saved(page, item.id)).toMatchObject({
    sex: "雄性",
    intakeDate: "2026-11-11",
    endDate: "2027-01-11",
    husbandryDays: 61,
    cards: item.cards,
    status: item.status,
  });
});

test("end date options show the merged value and accept explicit endpoint selections", async ({ page }) => {
  await setup(page);
  const item = await original(page, true, {
    intakeDate: "",
    endDate: "2027-01-04",
    husbandryDays: 61,
    husbandryMonths: null,
  });
  await page
    .getByLabel("预约消息", { exact: true })
    .fill(
      `饲养需求批次号：${item.batchNo}\n采购单号：${item.purchaseOrderNo}\n订单编号：${item.orderNo}\n进驻日期：2026-11-11`,
    );
  await ai(page, item, false, {
    intakeDate: "2026-11-11",
    endDate: "2027-01-11",
    husbandryDays: null,
    husbandryMonths: null,
  });
  const dialog = review(page);
  const endChoice = dialog.getByRole("radiogroup", { name: "结束日期取值", exact: true });
  await expect(endChoice.getByRole("radio", { name: "2027-01-11", exact: true })).toBeChecked();
  const endRow = dialog.getByRole("row").filter({ has: page.getByRole("cell", { name: "结束日期", exact: true }) });
  const daysRow = dialog.getByRole("row").filter({ has: page.getByRole("cell", { name: "饲养天数", exact: true }) });
  await expect(endRow).toContainText("原值 2027-01-04 → 合并后 2027-01-11");
  const choiceRequests: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/intake-batches/recognition-preview")
      choiceRequests.push(request.postDataJSON().resolutions);
  });
  const explicitPreview = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/intake-batches/recognition-preview" &&
      response.request().postDataJSON().resolutions?.endDate === "incoming",
  );
  await endChoice.getByText("2027-01-11", { exact: true }).click();
  expect((await explicitPreview).ok()).toBe(true);
  await expect(endChoice.getByRole("radio", { name: "2027-01-11", exact: true })).toBeEnabled();
  expect(choiceRequests).toEqual([{ endDate: "incoming" }]);
  await endChoice.getByText("2027-01-04", { exact: true }).click();
  await expect(endRow).toContainText("原值 2027-01-04 → 合并后 2027-01-04");
  await expect(daysRow).toContainText("原值 61 → 合并后 54");
  await expect(daysRow).toContainText("由日期区间计算：2027-01-04 − 2026-11-11 = 54 天");
  expect(choiceRequests).toEqual([{ endDate: "incoming" }, { endDate: "saved" }]);
  await dialog.getByRole("button", { name: "确认补充原预约", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await saved(page, item.id)).toMatchObject({
    intakeDate: "2026-11-11",
    endDate: "2027-01-04",
    husbandryDays: 54,
    cards: item.cards,
  });
});

test("images supplement a text appointment and replace the unconfirmed sex placeholder", async ({ page }, info) => {
  await setup(page);
  const item = await original(page, false, {
    purchaseOrderNo: "C2026110917024",
    orderNo: "",
    batchNo: "（Z2026032）2026110607",
    iacuc: "Z2026032",
    rawMessage: "供应商：广东药康\n品系：c57\n数量：12\n拟进驻日期：261111",
    specification: "",
    sex: "雌性/雄性",
    quantity: 12,
    finalCardCount: 3,
    intakeDate: "2026-11-11",
    endDate: "2026-11-28",
    husbandryDays: 17,
    husbandryMonths: null,
  });
  await ai(
    page,
    item,
    true,
    { specification: "6w", sex: "雌性", intakeDate: "", endDate: "" },
    {
      fieldSources: { sex: "本批雄性0只、雌性12只", specification: "采购6周龄 雌" },
      sources: [
        {
          imageIndex: 1,
          kind: "husbandry",
          batchNo: item.batchNo,
          iacuc: item.iacuc,
          strainRaw: "C57",
          specification: "6-8周",
          quantity: 12,
          maleQuantity: 0,
          femaleQuantity: 12,
          husbandryDays: 17,
        },
        {
          imageIndex: 1,
          kind: "purchase",
          batchNo: item.batchNo,
          purchaseOrderNo: item.purchaseOrderNo,
          productName: "C57BL/6JGpt小鼠",
          specification: "6周龄 雌",
          quantity: 12,
        },
      ],
    },
  );
  const dialog = review(page);
  await expect(dialog).toContainText("以本次图片信息为主，原预约文字补充空缺");
  const sexRow = dialog.getByRole("row").filter({ has: page.getByRole("cell", { name: "性别", exact: true }) });
  await expect(sexRow.getByRole("cell").nth(3)).toHaveText("雌性");
  await expect(sexRow).toContainText("可补充");
  const missing = dialog
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "订单编号", exact: true }) })
    .getByText("本次缺失", { exact: true });
  const supplement = sexRow.getByText("可补充", { exact: true });
  await expect(missing).toHaveClass(/ant-tag-warning/);
  await expect(supplement).toHaveClass(/ant-tag-processing/);
  expect(await missing.evaluate((node) => getComputedStyle(node).color)).not.toBe(
    await supplement.evaluate((node) => getComputedStyle(node).color),
  );
  expect(await saved(page, item.id)).toEqual(item);
  await page.screenshot({ path: info.outputPath("incoming-image-text-supplement.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "确认补充原预约", exact: true }).click();
  await expect(dialog).toBeHidden();
  const updated = await saved(page, item.id);
  expect(updated).toMatchObject({
    sex: "雌性",
    specification: "6w",
    intakeDate: "2026-11-11",
    endDate: "2026-11-28",
    husbandryDays: 17,
    quantity: 12,
    cards: item.cards,
  });
  expect(updated.recognition!.recognitionRounds!.at(-1)!.appliedFields).toContain("sex");
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
