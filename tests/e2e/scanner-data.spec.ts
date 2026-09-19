import type { APIResponse, Page } from "@playwright/test";

import { ensureTestInfrastructure, expect, openNavigationEntry, test } from "./fixtures";
import { captureUiAudit } from "./uiAudit";

async function successfulJson(response: Pick<APIResponse, "ok" | "json">) {
  const payload = await response.json();
  expect(response.ok(), JSON.stringify(payload)).toBe(true);
  return payload;
}

async function queryCode(page: Page, code: string) {
  await page.getByLabel("笼卡识别码", { exact: true }).fill(code);
  const response = page.waitForResponse((value) => value.url().includes("/api/public/cage-card/"));
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await successfulJson(await response);
}

test("real cage card data follows receipt and placement through internal and anonymous scans", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);

  const fixtureId = `scanner-data-${testInfo.retry}`;
  const batch = {
    id: fixtureId,
    batchNo: `真实扫码链路-${testInfo.retry}`,
    status: "pending_print",
    receiverName: "扫码回归接收人",
    iacuc: "Z2026091201",
    supplier: "扫码回归供应商",
    pi: "扫码项目负责人",
    owner: "扫码实验负责人",
    project: "扫码数据回归项目",
    roomName: "8014",
    intakeDate: "2026-09-12",
    endDate: "2026-10-12",
    quantity: 5,
    suggestedAnimalsPerCage: 5,
    finalCardCount: 1,
    species: "mouse",
    strainStandard: "C57BL/6J",
    sex: "雄",
    cards: [],
  };
  const created = await successfulJson(await page.request.post("/api/intake-batches", { data: { item: batch } }));
  const qrId: string = created.item.cards[0].qrId;
  expect(qrId).toMatch(/^[A-Z0-9]{4}$/);
  const legacyId = `${batch.iacuc}-20260912-01`;
  const apiPath = `/api/public/cage-card/${qrId}`;
  const transitions: Array<{ stage: string; payload: unknown }> = [];
  const result = page.locator(".scanner-result-card");

  async function assertState(status: string) {
    const payload = await successfulJson(await page.request.get(apiPath));
    expect(Object.keys(payload)).toEqual(["item"]);
    expect(payload.item).toMatchObject({
      qrId,
      batchNo: batch.batchNo,
      iacuc: batch.iacuc,
      pi: batch.pi,
      owner: batch.owner,
      strainStandard: batch.strainStandard,
      animalCount: 5,
      statusLabel: status,
    });
    for (const privateField of ["funding", "password", "auditLogs", "billingStatements", "notes"]) {
      expect(payload.item).not.toHaveProperty(privateField);
    }
    transitions.push({ stage: status, payload });
    // Query the same code again: a status change must not leave the previous cached result on screen.
    await queryCode(page, qrId);
    await expect(result.locator(".ant-tag")).toHaveText(status);
    for (const value of [batch.batchNo, batch.iacuc, batch.pi, batch.owner, batch.strainStandard, "5"]) {
      await expect(result.locator(".ant-descriptions").getByText(value, { exact: true })).toBeVisible();
    }
    await expect(result).not.toContainText("待接收");
    return payload.item;
  }

  await successfulJson(await page.request.post("/api/intake-batches/mark-printed", { data: { ids: [batch.id] } }));
  await openNavigationEntry(page, "笼卡管理", "二维码扫描");
  await assertState("已打印");

  const receipt = await successfulJson(
    await page.request.post(`/api/intake-batches/${batch.id}/confirm-receipt`, {
      data: { actualReceiptDate: "2026-09-12", cardCount: 1 },
    }),
  );
  expect(receipt.batch.status).toBe("received");
  const taskId: string = receipt.tasks[0].id;
  expect(receipt.tasks[0].qrId).toBe(qrId);
  await assertState("待进驻");

  const rackId = `${fixtureId}-rack`;
  const slotId = `${fixtureId}-slot`;
  await successfulJson(
    await page.request.post("/api/racks", {
      data: { item: { id: rackId, roomId: "room-e2e-8014", name: "扫码回归笼架", index: 9, rows: 1, cols: 1 } },
    }),
  );
  await successfulJson(
    await page.request.post("/api/cage-slots", {
      data: { item: { id: slotId, rackId, row: 1, col: 1, code: "8014-09-A1", status: "empty" } },
    }),
  );
  await successfulJson(await page.request.post(`/api/placement-tasks/${taskId}/reserve`, { data: { slotId } }));
  await assertState("已预留");
  await successfulJson(
    await page.request.post(`/api/placement-tasks/${taskId}/move-in`, {
      data: { actualMoveInDate: "2026-09-14" },
    }),
  );
  const active = await assertState("已入驻");
  await expect(result.getByText("8014", { exact: true })).toBeVisible();
  await expect(result.getByText(active.cageCode || active.slotCode, { exact: true })).toBeVisible();

  await queryCode(page, `https://example.test/scan/cage-card/${legacyId}`);
  await expect(result.locator(".ant-tag")).toHaveText("已入驻");
  await expect(result.locator(".ant-card-head-title")).toHaveText(batch.batchNo);
  await captureUiAudit(page, testInfo, "scanner-real-data", result);

  const anonymous = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const publicPage = await anonymous.newPage();
    expect((await anonymous.request.get("/api/auth/me")).status()).toBe(401);
    for (const code of [qrId, legacyId]) {
      const payload = await successfulJson(await anonymous.request.get(`/api/public/cage-card/${code}`));
      expect(payload.item).toMatchObject({ ...active, qrId: code });
      await publicPage.goto(`/c/${code}`);
      await expect(publicPage.getByRole("heading", { name: batch.batchNo, exact: true })).toBeVisible();
      await expect(publicPage.locator(".public-scan-status")).toHaveText("已入驻");
      for (const value of [batch.iacuc, batch.pi, batch.owner, batch.strainStandard, "5 只", "2026-09-14"]) {
        await expect(publicPage.locator("dd").getByText(value, { exact: true })).toBeVisible();
      }
      await expect(publicPage.locator(".public-scan-card")).not.toContainText("待接收");
    }
    await captureUiAudit(publicPage, testInfo, "public-scanner-real-data");
  } finally {
    await anonymous.close();
  }
  await testInfo.attach("real-cage-card-api-transitions", {
    body: JSON.stringify(transitions, null, 2),
    contentType: "application/json",
  });
});
