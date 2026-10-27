import type { Page, Route } from "@playwright/test";
import { ensureTestInfrastructure, expect, openIntakeEntry, openNavigationEntry, test } from "./fixtures";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAD0lEQVR4nGP4TwAwjAwFAIS1/wF0QtmAAAAAAElFTkSuQmCC",
  "base64",
);
const image = { name: "预约.png", mimeType: "image/png", buffer: png };
const evidence = {
  extractedText: "24只，4周，8101，4笼",
  warnings: ["未明确接收日期，请核对"],
  fieldSources: { quantity: "预约.png", finalCardCount: "预约.png" },
};

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeHidden();
  await ensureTestInfrastructure(page);
  await openIntakeEntry(page);
}

async function addImage(page: Page) {
  await page.getByLabel("预约图片文件", { exact: true }).setInputFiles(image);
  await expect(page.getByRole("button", { name: "移除图片 预约.png" })).toBeVisible();
}

function aiItem(batchNo: string, iacuc = "") {
  return {
    batchNo,
    iacuc,
    supplier: "测试供应商",
    pi: "测试负责人",
    owner: "测试实验负责人",
    species: "mouse",
    quantity: 24,
    husbandryDays: 28,
    roomName: "8014",
    finalCardCount: 4,
  };
}

async function setDate(page: Page) {
  const input = page.getByLabel("接收日期", { exact: true });
  await input.fill("2026-10-21");
  await page.locator(".ant-picker-dropdown:visible").getByTitle("2026-10-21", { exact: true }).click();
}

async function finish(route: Route, payload: unknown) {
  try {
    await route.fulfill({ json: payload });
  } catch {
    /* An aborted browser request is expected after editing. */
  }
}

test("an approximate IACUC search result never supplies another project's responsible people", async ({ page }) => {
  await login(page);
  await page.route("**/api/iacuc-index?**", (route) =>
    finish(route, { items: [{ iacuc: "Z20261080", pi: "不应回填负责人", owner: "不应回填实验负责人" }] }),
  );
  await page.route("**/api/intake/ai-parse", (route) =>
    finish(route, { item: { ...aiItem("EXACT-IACUC", "Z2026108"), pi: "", owner: "" }, recognition: evidence }),
  );
  await addImage(page);
  await page.getByRole("button", { name: "AI识别", exact: true }).click();
  await expect(page.getByLabel("IACUC 编号", { exact: true })).toHaveValue("Z2026108");
  await expect(page.getByRole("button", { name: "AI识别", exact: true })).toBeEnabled();
  await expect(page.getByLabel("项目负责人", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("实验负责人", { exact: true })).toHaveValue("");
});

test("recognizes synthetic images and persists evidence and original bytes in the isolated service", async ({
  page,
}, info) => {
  const batchNo = `E2E-IMAGE-${Date.now()}`;
  await login(page);
  await page.route("**/api/intake/ai-parse", (route) =>
    finish(route, {
      item: { ...aiItem(batchNo, "Z2026001"), specification: "6–8个月" },
      recognition: {
        ...evidence,
        warnings: [...evidence.warnings, "体重/日龄与采购规格不一致，已优先采用采购规格，请核对。"],
        sources: [
          {
            imageIndex: 1,
            kind: "husbandry",
            batchNo,
            specification: "2–6月",
            approvedQuantity: 240,
            quantity: 24,
            maleQuantity: 12,
            femaleQuantity: 12,
          },
          {
            imageIndex: 2,
            kind: "purchase",
            batchNo,
            purchaseOrderNo: "PO-123",
            specification: "6–8个月",
            quantity: 24,
            supplier: "测试供应商",
          },
        ],
      },
    }),
  );
  await page.getByLabel("预约图片文件", { exact: true }).setInputFiles([image, { ...image, name: "采购信息.png" }]);
  await expect(page.getByRole("button", { name: "移除图片 采购信息.png" })).toBeVisible();
  await expect(page.getByRole("button", { name: "本地识别" })).toBeDisabled();
  await page.getByRole("button", { name: "AI识别" }).click();
  await expect(page.getByLabel("数量（只）", { exact: true })).toHaveValue("24");
  await expect(page.getByLabel("体重/日龄（规格）", { exact: true })).toHaveValue("6–8个月");
  await expect(page.getByLabel("打印张数", { exact: true })).toHaveValue("4");
  await expect(page.getByLabel("接收日期", { exact: true })).toHaveValue("");
  await expect(page.getByText("未明确接收日期，请核对")).toBeHidden();
  await page.getByRole("button", { name: /请核对识别提示/ }).click();
  await expect(page.getByText("未明确接收日期，请核对")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "饲养需求", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "采购信息", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "2–6月", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "6–8个月", exact: true })).toBeVisible();
  await page.getByText("识别依据与留档").click();
  await expect(page.getByText("饲养需求（图片 1）")).toBeVisible();
  await expect(page.getByText("可申请总数量（只）：240")).toBeVisible();
  await expect(page.getByText("本批动物数量（只）：24")).toBeVisible();
  await expect(page.getByText("采购信息（图片 2）")).toBeVisible();
  await expect(page.getByText("采购单号：PO-123")).toBeVisible();
  await expect(page.getByRole("region", { name: "饲养需求，图片 1" })).toContainText(`批次编号：${batchNo}`);
  await expect(page.getByRole("region", { name: "采购信息，图片 2" })).toContainText(`批次编号：${batchNo}`);
  await expect(page.getByText("采购数量（只）：24")).toBeVisible();
  await expect(page.getByText("数量（只）：预约.png")).toBeVisible();
  await expect(page.getByText("打印张数：预约.png")).toBeVisible();
  await expect(page.getByRole("button", { name: "AI识别", exact: true })).toBeEnabled();
  await page.getByText("饲养需求（图片 1）").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("structured-sources.png"), fullPage: true, animations: "disabled" });
  await setDate(page);
  const savedResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/intake-batches" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存待接收批次", exact: true }).click();
  const response = await savedResponse;
  expect(response.ok()).toBe(true);
  const saved = (await response.json()) as {
    item: {
      id: string;
      specification: string;
      recognition: { extractedText: string; images: Array<{ url: string; name: string }> };
    };
  };
  try {
    expect(saved.item.specification).toBe("6–8个月");
    expect(saved.item.recognition.extractedText).toBe(evidence.extractedText);
    expect(saved.item.recognition.images).toHaveLength(2);
    const reread = await page.request.get(`/api/intake-batches/${encodeURIComponent(saved.item.id)}`);
    expect(reread.ok()).toBe(true);
    const persisted = (await reread.json()) as typeof saved;
    expect(persisted.item.specification).toBe("6–8个月");
    expect(persisted.item.recognition.images[0].name).toBe("预约.png");
    const original = await page.request.get(persisted.item.recognition.images[0].url);
    expect(original.ok()).toBe(true);
    expect(await original.body()).toEqual(png);
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    await page.locator("tr", { hasText: batchNo }).getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByLabel("体重/日龄（规格）", { exact: true })).toHaveValue("6–8个月");
    await page.getByRole("button", { name: /请核对识别提示/ }).click();
    await page.getByText("识别依据与留档").click();
    await expect(page.getByText(evidence.extractedText)).toBeVisible();
    await expect(page.getByAltText("已留档 预约.png")).toBeVisible();
    const editor = page.getByRole("dialog", { name: "编辑待接收批次" });
    await editor.getByLabel("体重/日龄（规格）", { exact: true }).fill("6–8个月（已核对）");
    const updateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === `/api/intake-batches/${saved.item.id}`,
    );
    await editor.getByRole("button", { name: "保存待接收批次", exact: true }).click();
    expect((await updateResponse).ok()).toBe(true);
    const afterUpdate = await page.request.get(`/api/intake-batches/${encodeURIComponent(saved.item.id)}`);
    expect(((await afterUpdate.json()) as typeof saved).item.specification).toBe("6–8个月（已核对）");
  } finally {
    await page.request.delete(`/api/intake-batches/${encodeURIComponent(saved.item.id)}`);
  }
});

test("failed recognition preserves inputs and changed images invalidate delayed responses", async ({ page }) => {
  await login(page);
  await addImage(page);
  await page.getByLabel("预约消息", { exact: true }).fill("请保留这段文字");
  await page.route("**/api/intake/ai-parse", (route) => route.fulfill({ status: 503, json: { error: "模拟失败" } }));
  await page.getByRole("button", { name: "AI识别" }).click();
  await expect(page.getByText("模拟失败")).toBeVisible();
  await expect(page.getByLabel("预约消息", { exact: true })).toHaveValue("请保留这段文字");
  await expect(page.getByRole("button", { name: "移除图片 预约.png" })).toBeVisible();
  await page.unroute("**/api/intake/ai-parse");
  let release = () => {};
  let started = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/intake/ai-parse", async (route) => {
    started();
    await gate;
    await finish(route, { item: aiItem("STALE"), recognition: evidence });
  });
  await page.getByRole("button", { name: "AI识别" }).click();
  await waiting;
  await page.getByRole("button", { name: "移除图片 预约.png" }).click();
  release();
  await expect(page.getByLabel("批次号", { exact: true })).not.toHaveValue("STALE");
  await expect(page.getByLabel("预约消息", { exact: true })).toHaveValue("请保留这段文字");
});

test("a late IACUC lookup cannot overwrite a new draft", async ({ page }) => {
  await login(page);
  let release = () => {};
  let started = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/iacuc-index?**", async (route) => {
    started();
    await gate;
    await finish(route, { items: [{ pi: "旧负责人", owner: "旧实验负责人" }] });
  });
  await page.route("**/api/intake/ai-parse", (route) =>
    finish(route, { item: aiItem("STALE-IACUC", "Z9999999"), recognition: evidence }),
  );
  await addImage(page);
  await page.getByRole("button", { name: "AI识别" }).click();
  await waiting;
  await page.getByRole("button", { name: "新建批次", exact: true }).click();
  release();
  await expect(page.getByLabel("批次号", { exact: true })).not.toHaveValue("STALE-IACUC");
  await expect(page.getByLabel("项目负责人", { exact: true })).not.toHaveValue("旧负责人");
});

test("saving stays disabled while a selected image is being read", async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    // Preserve the native method to release the intentionally delayed read.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (file) {
      (window as unknown as { finishIntakeRead: () => void }).finishIntakeRead = () => original.call(this, file);
    };
  });
  await page.getByLabel("预约图片文件", { exact: true }).setInputFiles(image);
  await expect(page.getByRole("button", { name: "保存待接收批次", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "AI识别" })).toHaveClass(/ant-btn-loading/);
  await page.evaluate(() => (window as unknown as { finishIntakeRead: () => void }).finishIntakeRead());
  await expect(page.getByRole("button", { name: "移除图片 预约.png" })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存待接收批次", exact: true })).toBeEnabled();
});

for (const action of ["save", "print"] as const) {
  test(`${action} duplicate confirmation keeps the selected image in both save requests`, async ({ page }) => {
    await login(page);
    const suffix = Date.now();
    const existingId = `image-existing-${action}-${suffix}`;
    const batchNo = `E2E-IMAGE-DUP-${action}-${suffix}`;
    const existing = await page.request.post("/api/intake-batches", {
      data: {
        item: {
          id: existingId,
          ...aiItem(batchNo, "Z2026001"),
          intakeDate: "2026-10-21",
          status: "pending_print",
          cards: [],
        },
      },
    });
    expect(existing.ok()).toBe(true);
    let savedId = "";
    try {
      await page.route("**/api/intake/ai-parse", (route) =>
        finish(route, { item: aiItem(batchNo, "Z2026001"), recognition: evidence }),
      );
      await addImage(page);
      await page.getByRole("button", { name: "AI识别" }).click();
      await expect(page.getByLabel("批次号", { exact: true })).toHaveValue(batchNo);
      await setDate(page);
      const bodies: Array<{
        recognitionImages?: Array<{ name: string; dataUrl: string }>;
        duplicateConfirmation?: string;
      }> = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname === "/api/intake-batches")
          bodies.push(request.postDataJSON());
      });
      if (action === "save") {
        await page.getByRole("button", { name: "保存待接收批次", exact: true }).click();
      } else {
        await page.getByRole("button", { name: "打印当前笼卡", exact: true }).click();
        const printConfirm = page.getByRole("dialog", { name: "补齐空白笼卡", exact: true });
        await printConfirm.getByRole("button", { name: "直接打印", exact: true }).click();
      }
      const duplicate = page.getByRole("dialog", { name: "发现重复待接收批次", exact: true });
      await expect(duplicate).toBeVisible();
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/intake-batches" &&
          Boolean(response.request().postDataJSON()?.duplicateConfirmation),
      );
      await duplicate.getByRole("button", { name: "仍然保存", exact: true }).click();
      const response = await saved;
      expect(response.ok()).toBe(true);
      savedId = ((await response.json()) as { item: { id: string } }).item.id;
      expect(bodies).toHaveLength(2);
      for (const body of bodies)
        expect(body.recognitionImages).toEqual([
          expect.objectContaining({ name: "预约.png", dataUrl: `data:image/png;base64,${png.toString("base64")}` }),
        ]);
      expect(bodies[1].duplicateConfirmation).toBeTruthy();
    } finally {
      if (savedId) await page.request.delete(`/api/intake-batches/${encodeURIComponent(savedId)}`);
      await page.request.delete(`/api/intake-batches/${encodeURIComponent(existingId)}`);
    }
  });
}

test("closing the editor invalidates a pending recognition result", async ({ page }) => {
  await login(page);
  const id = `image-close-${Date.now()}`;
  const batchNo = `E2E-IMAGE-CLOSE-${Date.now()}`;
  expect(
    (
      await page.request.post("/api/intake-batches", {
        data: {
          item: { id, ...aiItem(batchNo, "Z2026001"), intakeDate: "2026-10-21", status: "pending_print", cards: [] },
        },
      })
    ).ok(),
  ).toBe(true);
  try {
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    await page.locator("tr", { hasText: batchNo }).getByRole("button", { name: "编辑", exact: true }).click();
    let release = () => {};
    let started = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    await page.route("**/api/intake/ai-parse", async (route) => {
      started();
      await gate;
      await finish(route, { item: aiItem("CLOSED-STALE"), recognition: evidence });
    });
    await addImage(page);
    await page.getByRole("button", { name: "AI识别" }).click();
    await waiting;
    await page
      .getByRole("dialog", { name: "编辑待接收批次" })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    release();
    await expect(page.getByRole("dialog", { name: "编辑待接收批次" })).toBeHidden();
    await page.locator("tr", { hasText: batchNo }).getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByLabel("批次号", { exact: true })).toHaveValue(batchNo);
  } finally {
    await page.request.delete(`/api/intake-batches/${encodeURIComponent(id)}`);
  }
});

for (const change of ["text", "new"] as const) {
  test(`a late AI response cannot overwrite the draft after ${change}`, async ({ page }) => {
    await login(page);
    await addImage(page);
    await page.getByLabel("预约消息", { exact: true }).fill("原始文字");
    let release = () => {};
    let started = () => {};
    let completed = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      completed = resolve;
    });
    await page.route("**/api/intake/ai-parse", async (route) => {
      started();
      await gate;
      await finish(route, { item: aiItem("STALE-AI"), recognition: evidence });
      completed();
    });
    await page.getByRole("button", { name: "AI识别" }).click();
    await waiting;
    if (change === "text") await page.getByLabel("预约消息", { exact: true }).fill("修改后文字");
    else await page.getByRole("button", { name: "新建批次", exact: true }).click();
    release();
    await finished;
    await expect(page.getByLabel("批次号", { exact: true })).not.toHaveValue("STALE-AI");
    await expect(page.getByLabel("预约消息", { exact: true })).toHaveValue(change === "text" ? "修改后文字" : "");
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1180, height: 820 },
  { width: 760, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`image controls remain reachable without page overflow at ${viewport.width} x ${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await login(page);
    const message = page.getByLabel("预约消息", { exact: true });
    const picker = page.getByRole("button", { name: "选择预约图片", exact: true });
    await picker.focus();
    await page.keyboard.press("Tab");
    await expect(message).toBeFocused();
    await addImage(page);
    const remove = page.getByRole("button", { name: "移除图片 预约.png" });
    await expect(remove).toBeVisible();
    await page.screenshot({ path: info.outputPath(`image-controls-${viewport.width}.png`), fullPage: true });
    await remove.focus();
    await page.keyboard.press("Enter");
    await expect(remove).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}

test("a delayed local strain lookup cannot overwrite a new draft", async ({ page }) => {
  await login(page);
  let release = () => {};
  let started = () => {};
  let completed = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    completed = resolve;
  });
  await page.route("**/api/intake/standardize-strain", async (route) => {
    started();
    await gate;
    await finish(route, { item: "迟到品系" });
    completed();
  });
  await page.getByLabel("预约消息", { exact: true }).fill("批次号：LOCAL-STALE\n品系：未知品系XYZ\n数量：24");
  await page.getByRole("button", { name: "本地识别" }).click();
  await waiting;
  await page.getByRole("button", { name: "新建批次", exact: true }).click();
  release();
  await finished;
  await expect(page.getByLabel("批次号", { exact: true })).not.toHaveValue("LOCAL-STALE");
  await expect(page.getByLabel("预约消息", { exact: true })).toHaveValue("");
});

test("a delayed local IACUC lookup cannot overwrite edited text", async ({ page }) => {
  await login(page);
  let release = () => {};
  let started = () => {};
  let completed = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    completed = resolve;
  });
  await page.route("**/api/iacuc-index?**", async (route) => {
    started();
    await gate;
    await finish(route, { items: [{ pi: "迟到负责人", owner: "迟到实验负责人" }] });
    completed();
  });
  await page.getByLabel("预约消息", { exact: true }).fill("饲养需求批次号：(Z9999999)202610221234\n数量：24");
  await page.getByRole("button", { name: "本地识别" }).click();
  await waiting;
  await page.getByLabel("预约消息", { exact: true }).fill("修改后的预约文字");
  release();
  await finished;
  await expect(page.getByLabel("项目负责人", { exact: true })).not.toHaveValue("迟到负责人");
  await expect(page.getByLabel("预约消息", { exact: true })).toHaveValue("修改后的预约文字");
});

test("a quantity conflict shows both sources and retains the purchase quantity", async ({ page }) => {
  await login(page);
  await page.route("**/api/intake/ai-parse", (route) =>
    finish(route, {
      item: { ...aiItem("QUANTITY-CONFLICT", "Z2026001"), quantity: 30 },
      recognition: {
        ...evidence,
        warnings: ["本批数量不一致，已优先采用采购数量，请核对。"],
        sources: [
          { imageIndex: 1, kind: "husbandry", batchNo: "QUANTITY-CONFLICT", quantity: 24 },
          { imageIndex: 2, kind: "purchase", batchNo: "QUANTITY-CONFLICT", quantity: 30 },
        ],
      },
    }),
  );
  await page.getByLabel("预约图片文件", { exact: true }).setInputFiles([image, { ...image, name: "采购信息.png" }]);
  await expect(page.getByRole("button", { name: "移除图片 采购信息.png" })).toBeVisible();
  await page.getByRole("button", { name: "AI识别", exact: true }).click();
  await expect(page.getByLabel("数量（只）", { exact: true })).toHaveValue("30");
  const toggle = page.getByRole("button", { name: /请核对识别提示/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("cell", { name: "24 只", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "30 只", exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("识别依据与留档")).toBeHidden();
  await toggle.click();
  await page.getByText("识别依据与留档").click();
  await expect(page.getByText("本批动物数量（只）：24")).toBeVisible();
  await expect(page.getByText("采购数量（只）：30")).toBeVisible();
});

test("calculated purchase quantity and its facts survive save and reload", async ({ page }) => {
  const batchNo = `E2E-QUANTITY-FACTS-${Date.now()}`;
  const quantityFacts = {
    lineQuantity: 27,
    lineQuantityEvidence: "明细 27 只",
    giftQuantity: 3,
    giftEvidence: "本次额外赠送 3 只",
    giftInclusion: "extra",
    giftScope: "current_item",
    currentDeliveryQuantity: 30,
    currentDeliveryEvidence: "本次 30 只",
    deferredQuantity: 47,
    deferredEvidence: "后续 47 只",
    purchaseNotes: "需求 77 只",
  };
  const quantityCalculation = {
    baseQuantity: 27,
    giftQuantity: 3,
    addedGiftQuantity: 3,
    actualQuantity: 30,
    formula: "27 + 3 = 30",
    status: "calculated",
    reason: "赠送属于当前商品",
  };
  await login(page);
  await page.route("**/api/intake/ai-parse", (route) =>
    finish(route, {
      item: { ...aiItem(batchNo, "Z2026001"), quantity: 30, specification: "6-8w" },
      recognition: {
        ...evidence,
        sources: [{ imageIndex: 1, kind: "purchase", batchNo, specification: "6-8周龄", quantity: 27, quantityFacts }],
        quantityCalculation,
      },
    }),
  );
  await addImage(page);
  await page.getByRole("button", { name: "AI识别", exact: true }).click();
  await expect(page.getByLabel("数量（只）", { exact: true })).toHaveValue("30");
  await expect(page.getByLabel("体重/日龄（规格）", { exact: true })).toHaveValue("6-8w");
  await page.getByRole("button", { name: /请核对识别提示/ }).click();
  await page.getByText("识别依据与留档").click();
  await expect(page.getByText("采购数量（只）：27")).toBeVisible();
  await expect(page.getByText("规格：6-8周龄", { exact: true })).toBeVisible();
  await expect(page.getByText("本次到货备注数量（只）：30")).toBeVisible();
  await expect(page.getByText("后续到货备注数量（只）：47")).toBeVisible();
  await expect(page.getByText("计算式：27 + 3 = 30")).toBeVisible();
  await setDate(page);
  const savedResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/intake-batches" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存待接收批次", exact: true }).click();
  const response = await savedResponse;
  expect(response.ok()).toBe(true);
  const saved = (await response.json()) as { item: { id: string } };
  try {
    const reread = await page.request.get(`/api/intake-batches/${encodeURIComponent(saved.item.id)}`);
    expect(reread.ok()).toBe(true);
    const persisted = (await reread.json()) as {
      item: {
        quantity: number;
        specification: string;
        recognition: { sources: unknown[]; quantityCalculation: unknown };
      };
    };
    expect(persisted.item.quantity).toBe(30);
    expect(persisted.item.specification).toBe("6-8w");
    expect(persisted.item.recognition.sources[0]).toEqual(expect.objectContaining({ quantity: 27, quantityFacts }));
    expect(persisted.item.recognition.quantityCalculation).toEqual(quantityCalculation);
  } finally {
    await page.request.delete(`/api/intake-batches/${encodeURIComponent(saved.item.id)}`);
  }
});

test("review-required recognition clears an earlier quantity", async ({ page }) => {
  await login(page);
  await page.route("**/api/intake/ai-parse", (route) =>
    finish(route, {
      item: { ...aiItem("QUANTITY-REVIEW", "Z2026001"), quantity: null },
      recognition: {
        ...evidence,
        warnings: ["赠送归属不明确，请核对数量"],
        sources: [
          {
            imageIndex: 1,
            kind: "purchase",
            quantity: 27,
            quantityFacts: { lineQuantity: 27, giftQuantity: 3, giftInclusion: "unknown", giftScope: "unknown" },
          },
        ],
        quantityCalculation: {
          baseQuantity: 27,
          giftQuantity: 3,
          addedGiftQuantity: 0,
          actualQuantity: null,
          formula: "",
          status: "review_required",
          reason: "赠送归属不明确",
        },
      },
    }),
  );
  await addImage(page);
  await page.getByLabel("数量（只）", { exact: true }).fill("99");
  await page.getByRole("button", { name: "AI识别", exact: true }).click();
  await expect(page.getByLabel("数量（只）", { exact: true })).toHaveValue("");
  await expect(page.getByText("赠送归属不明确，请核对数量")).toBeHidden();
  await page.getByRole("button", { name: /请核对识别提示/ }).click();
  await expect(page.getByText("赠送归属不明确，请核对数量")).toBeVisible();
  await page.getByText("识别依据与留档").click();
  await expect(page.getByText("实际数量（只）：未确定")).toBeVisible();
  await expect(page.getByText("计算状态：需核对")).toBeVisible();
});

for (const width of [1237, 390]) {
  test(`recognition comparison columns fit their card at ${width}px`, async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/intake/ai-parse", (route) =>
      finish(route, {
        item: aiItem("REVIEW-LAYOUT", "Z2026001"),
        recognition: {
          ...evidence,
          warnings: ["体重/日龄（规格）差异：饲养需求为“6-8周龄”，采购信息为“3-5周”，已采用采购信息。"],
          sources: [
            { imageIndex: 1, kind: "husbandry", specification: "6-8周龄" },
            { imageIndex: 2, kind: "purchase", specification: "3-5周" },
          ],
        },
      }),
    );
    await addImage(page);
    await page.getByRole("button", { name: "AI识别", exact: true }).click();
    const toggle = page.getByRole("button", { name: /请核对识别提示/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(page.getByRole("columnheader", { name: "采购信息", exact: true })).toBeVisible();
    expect(await page.locator(".ant-workspace").evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(
      true,
    );
    expect(
      await page
        .locator(".intake-recognition-comparison table")
        .evaluate((node) => node.getBoundingClientRect().right <= window.innerWidth + 1),
    ).toBe(true);
  });
}

test("calendar-month period waits for a date and persists its actual day count", async ({ page }) => {
  await login(page);
  const batchNo = `E2E-CALENDAR-${Date.now()}`;
  await page.route("**/api/intake/ai-parse", (route) =>
    finish(route, {
      item: { ...aiItem(batchNo, "Z2026001"), intakeDate: "", endDate: "", husbandryDays: null, husbandryMonths: 1 },
      recognition: {
        ...evidence,
        sources: [
          { imageIndex: 1, kind: "husbandry", husbandryMonths: 1, reviewNotes: "房间号为8101，17笼小鼠，周期为1个月" },
        ],
      },
    }),
  );
  await addImage(page);
  await page.getByRole("button", { name: "AI识别", exact: true }).click();
  await expect(page.getByLabel("饲养周期（天）", { exact: true })).toHaveValue("");
  await expect(page.getByText("按 1 个自然月计算，请先填写接收日期", { exact: true })).toBeVisible();
  async function date(value: string) {
    await page.getByLabel("接收日期", { exact: true }).fill(value);
    await page.locator(".ant-picker-dropdown:visible").getByTitle(value, { exact: true }).click();
  }
  await date("2026-10-26");
  await expect(page.getByLabel("结束日期", { exact: true })).toHaveValue("2026-11-26");
  await expect(page.getByLabel("饲养周期（天）", { exact: true })).toHaveValue("31");
  await date("2026-01-31");
  await expect(page.getByLabel("结束日期", { exact: true })).toHaveValue("2026-02-28");
  await expect(page.getByLabel("饲养周期（天）", { exact: true })).toHaveValue("28");
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/intake-batches" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存待接收批次", exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const saved = await response.json();
  try {
    const reread = await page.request.get(`/api/intake-batches/${encodeURIComponent(saved.item.id)}`);
    const persisted = await reread.json();
    expect(persisted.item).toMatchObject({ husbandryMonths: 1, husbandryDays: 28, endDate: "2026-02-28" });
  } finally {
    await page.request.delete(`/api/intake-batches/${encodeURIComponent(saved.item.id)}`);
  }
});
