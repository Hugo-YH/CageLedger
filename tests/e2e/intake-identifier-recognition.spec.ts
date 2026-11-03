import type { IntakeBatch, IntakeDuplicateDetails, IntakeWriteResponse } from "../../src/contracts/intake";
import { ensureTestInfrastructure, expect, openIntakeEntry, openNavigationEntry, test } from "./fixtures";

const purchase = "C2026100925690";
const order = "DC202610092569007";
const batchNo = "（Z2024020）2026100812";

function message(identifiers: string, quantity = 6) {
  return `${identifiers}\n饲养需求批次号：${batchNo}\n供应商：合成测试供应商\n品系：c57\n数量：${quantity}\n饲养房间：8014\n接收日期：2026-11-03`;
}

test("local intake recognition classifies C and DC identifiers and preserves reviewed fields on conflicts", async ({
  page,
}, info) => {
  const health = await page.request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect((await health.json()).database).toContain("cageledger-e2e-");
  const login = await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } });
  expect(login.ok()).toBe(true);
  await page.goto("/app");
  await ensureTestInfrastructure(page);
  await openIntakeEntry(page);

  const raw = page.getByLabel("预约消息", { exact: true });
  const purchaseField = page.getByLabel("采购单号", { exact: true });
  const orderField = page.getByLabel("订单编号", { exact: true });
  const quantity = page.getByLabel("数量（只）", { exact: true });
  const supplier = page.getByLabel("购买单位", { exact: true });
  const owner = page.getByLabel("实验负责人", { exact: true });
  const recognize = page.getByRole("button", { name: "本地识别", exact: true });
  const success = page.getByRole("status").filter({ hasText: "预约消息已识别" });

  for (const [identifiers, expectedOrder] of [
    [`锐竞订单号：${purchase}`, ""],
    [`采购申请号：${order}`, order],
  ]) {
    await raw.fill(message(identifiers));
    await recognize.click();
    await expect(purchaseField).toHaveValue(purchase);
    await expect(orderField).toHaveValue(expectedOrder);
    await expect(page.getByLabel("批次号", { exact: true })).toHaveValue(batchNo);
    await expect(quantity).toHaveValue("6");
    await expect(success).toBeVisible();
    await success.getByRole("button", { name: "关闭通知" }).click();
    await expect(success).toBeHidden();
  }
  await page.locator("#intake-entry-panel").screenshot({
    path: info.outputPath("recognized-identifiers.png"),
    animations: "disabled",
  });

  await quantity.fill("17");
  await supplier.fill("人工核对供应商");
  await owner.fill("人工核对实验负责人");
  const warning = page.getByRole("status").filter({ hasText: "采购与订单编号需核对" });
  for (const [index, identifiers] of [`采购单号：C2026072329400\n订单编号：${order}`].entries()) {
    const conflictingMessage = message(identifiers, 99);
    await raw.fill(conflictingMessage);
    await recognize.click();
    await expect(warning).toBeVisible();
    await expect(purchaseField).toHaveValue(purchase);
    await expect(orderField).toHaveValue(order);
    await expect(quantity).toHaveValue("17");
    await expect(supplier).toHaveValue("人工核对供应商");
    await expect(owner).toHaveValue("人工核对实验负责人");
    await expect(raw).toHaveValue(conflictingMessage);
    await expect(success).toBeHidden();
    await page.screenshot({ path: info.outputPath(`identifier-conflict-${index}.png`), animations: "disabled" });
    await warning.getByRole("button", { name: "关闭通知" }).click();
    await expect(warning).toBeHidden();
  }
});

test("one 60-animal appointment retains both orders and demands through duplicate confirmation and reopening", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  const healthResponse = await page.request.get("/api/health");
  expect(healthResponse.ok()).toBe(true);
  const health = await healthResponse.json();
  expect(health.database).toContain("cageledger-e2e-");
  await info.attach("isolated-health", { body: JSON.stringify(health, null, 2), contentType: "application/json" });
  const login = await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } });
  expect(login.ok()).toBe(true);
  await page.goto("/app");
  await ensureTestInfrastructure(page);
  await openIntakeEntry(page);

  const purchaseOrderNos = ["C2026092129265", "C2026092129234"];
  const orderNos = ["DC202609212926501", "DC202609212923401"];
  const batchNos = ["（Z2025034）2025090302", "（Z2025034）2025090313"];
  const rawMessage = [
    `订单编号：${orderNos.join("、")}`,
    `饲养需求批次号：${batchNos.join("、")}`,
    "供应商：同组编号测试供应商",
    "品系：c57",
    "数量：60只",
    "饲养房间：8014",
    "接收日期：2026-11-03",
  ].join("\n");
  await page.getByLabel("预约消息", { exact: true }).fill(rawMessage);
  const previewRequest = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/intake-batches/recognition-preview"),
  );
  await page.getByRole("button", { name: "本地识别", exact: true }).click();
  const preview = await previewRequest;
  expect(preview.ok(), await preview.text()).toBe(true);
  expect((await preview.json()).total).toBe(0);
  await expect(page.getByLabel("采购单号", { exact: true })).toHaveValue(purchaseOrderNos.join("、"));
  await expect(page.getByLabel("订单编号", { exact: true })).toHaveValue(orderNos.join("、"));
  await expect(page.getByLabel("批次号", { exact: true })).toHaveValue(batchNos.join("、"));
  await expect(page.getByLabel("数量（只）", { exact: true })).toHaveValue("60");
  await expect(page.getByLabel("IACUC 编号", { exact: true })).toHaveValue("Z2025034");
  await expect(page.getByRole("status").filter({ hasText: "预约消息已识别" })).toContainText("总数量只记录一次");
  await page.getByLabel("项目负责人", { exact: true }).fill("同组测试项目负责人");
  await page.getByLabel("实验负责人", { exact: true }).fill("同组测试实验负责人");
  await page
    .locator("#intake-entry-panel")
    .screenshot({ path: info.outputPath("grouped-recognized.png"), animations: "disabled" });

  const suffix = Date.now();
  const existingIds = ["purchase", "order", "demand"].map((kind) => `grouped-${kind}-${suffix}`);
  let savedId = "";
  try {
    for (const [index, identifiers] of [
      { purchaseOrderNo: purchaseOrderNos[0], batchNo: `existing-purchase-${suffix}` },
      { orderNo: orderNos[1], batchNo: `existing-order-${suffix}` },
      { batchNo: batchNos[1] },
    ].entries()) {
      const response = await page.request.post("/api/intake-batches", {
        data: {
          item: {
            id: existingIds[index],
            ...identifiers,
            iacuc: "Z2025034",
            supplier: "同组编号已有记录",
            pi: `分编号测试负责人${index}`,
            owner: "分编号测试实验负责人",
            species: "mouse",
            roomName: "8014",
            intakeDate: "2026-11-03",
            quantity: 1,
            finalCardCount: 1,
            status: "pending_print",
            cards: [],
            receipts: [],
          },
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
    }

    const duplicateResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/intake-batches" && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "保存待接收批次", exact: true }).click();
    const duplicate = await duplicateResponse;
    expect(duplicate.status()).toBe(409);
    const duplicatePayload = (await duplicate.json()) as { code: string; details: IntakeDuplicateDetails };
    expect(duplicatePayload.code).toBe("INTAKE_DUPLICATE_CONFIRMATION_REQUIRED");
    expect(duplicatePayload.details.total).toBe(3);
    expect(duplicatePayload.details.items.map((item) => item.id).sort()).toEqual([...existingIds].sort());
    for (const [index, field] of ["purchaseOrderNo", "orderNo", "batchNo"].entries()) {
      expect(duplicatePayload.details.items.find((item) => item.id === existingIds[index])?.matchedFields).toContain(
        field,
      );
    }
    const confirmation = page.getByRole("dialog", { name: "发现重复待接收批次", exact: true });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("共匹配到 3 条记录");
    await page.screenshot({ path: info.outputPath("member-duplicate-confirmation.png"), animations: "disabled" });
    const confirmedResponse = page.waitForResponse((response) => {
      if (new URL(response.url()).pathname !== "/api/intake-batches" || response.request().method() !== "POST")
        return false;
      return Boolean(response.request().postDataJSON()?.duplicateConfirmation);
    });
    await confirmation.getByRole("button", { name: "仍然保存", exact: true }).click();
    const confirmed = await confirmedResponse;
    expect(confirmed.ok(), await confirmed.text()).toBe(true);
    const result = (await confirmed.json()) as IntakeWriteResponse;
    savedId = result.item.id;
    expect(result.item).toMatchObject({
      quantity: 60,
      purchaseOrderNo: purchaseOrderNos.join("、"),
      orderNo: orderNos.join("、"),
      batchNo: batchNos.join("、"),
      identifiers: { purchaseOrderNos, orderNos, batchNos },
    });
    expect(result.auditLogs).toContainEqual(expect.objectContaining({ action: "intake_batch.duplicate_confirmed" }));
    await expect(confirmation).toBeHidden();

    const detailResponse = await page.request.get(`/api/intake-batches/${encodeURIComponent(savedId)}`);
    expect(detailResponse.ok()).toBe(true);
    const saved = ((await detailResponse.json()) as { item: IntakeBatch }).item;
    expect(saved).toMatchObject({
      id: savedId,
      quantity: 60,
      rawMessage,
      identifiers: { purchaseOrderNos, orderNos, batchNos },
    });
    await info.attach("saved-grouped-appointment", {
      body: JSON.stringify(saved, null, 2),
      contentType: "application/json",
    });
    for (const [field, members] of Object.entries({
      purchaseOrderNo: purchaseOrderNos,
      orderNo: orderNos,
      batchNo: batchNos,
    })) {
      for (const member of members) {
        const query = await page.request.get("/api/intake-batches", {
          params: { view: "summary", columnFilters: JSON.stringify({ [field]: [member] }) },
        });
        expect(query.ok(), await query.text()).toBe(true);
        const items = (await query.json()).items as Array<{ id: string; quantity: number }>;
        expect(items.filter((item) => item.id === savedId)).toEqual([expect.objectContaining({ quantity: 60 })]);
      }
    }

    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    const row = page.locator("tr").filter({ hasText: batchNos.join("、") });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑待接收批次", exact: true });
    await expect(editor.getByLabel("采购单号", { exact: true })).toHaveValue(purchaseOrderNos.join("、"));
    await expect(editor.getByLabel("订单编号", { exact: true })).toHaveValue(orderNos.join("、"));
    await expect(editor.getByLabel("批次号", { exact: true })).toHaveValue(batchNos.join("、"));
    await expect(editor.getByLabel("数量（只）", { exact: true })).toHaveValue("60");
    await page.screenshot({ path: info.outputPath("grouped-editor-reopened.png"), animations: "disabled" });
    await editor.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(editor).toBeHidden();
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(editor.getByLabel("订单编号", { exact: true })).toHaveValue(orderNos.join("、"));
    await expect(editor.getByLabel("数量（只）", { exact: true })).toHaveValue("60");
  } finally {
    for (const id of [...existingIds, savedId].filter(Boolean))
      await page.request.delete(`/api/intake-batches/${encodeURIComponent(id)}`);
  }
});
