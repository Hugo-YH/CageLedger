import {
  ensureTestInfrastructure,
  expect,
  openIntakeEntry,
  openNavigationEntry,
  selectAntOptionByKeyboard,
  test,
} from "./fixtures";
import type { Page } from "@playwright/test";

async function setDate(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  // Confirm in the calendar; Enter would also submit the enclosing intake form.
  await page.locator(".ant-picker-dropdown:visible").getByTitle(value, { exact: true }).click();
  await expect(input).toHaveValue(value);
}

test("intake save requires an explicit confirmation for a duplicate batch and preserves the draft on return", async ({
  page,
}, testInfo) => {
  const suffix = Date.now();
  const existingId = `batch-e2e-duplicate-existing-${suffix}`;
  const laterId = `batch-e2e-duplicate-later-${suffix}`;
  const batchNo = `E2E-DUPLICATE/${suffix}`;
  const duplicateIds = async () => {
    const response = await page.request.get(
      `/api/intake-batches?${new URLSearchParams({
        limit: "100",
        offset: "0",
        columnFilters: JSON.stringify({ batchNo: [batchNo] }),
      }).toString()}`,
    );
    expect(response.ok()).toBe(true);
    const payload = (await response.json()) as { items: Array<{ id: string; batchNo: string }> };
    return payload.items.filter((item) => item.batchNo === batchNo).map((item) => item.id);
  };

  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  expect(
    (
      await page.request.post("/api/intake-batches", {
        data: {
          item: {
            id: existingId,
            batchNo,
            purchaseOrderNo: `PO-EXISTING-${suffix}`,
            iacuc: "Z2026001",
            supplier: "重复测试供应商",
            pi: "重复测试负责人",
            owner: "重复测试实验负责人",
            roomName: "8014",
            intakeDate: "2026-10-21",
            quantity: 5,
            finalCardCount: 1,
            species: "mouse",
            status: "pending_print",
            cards: [],
          },
        },
      })
    ).ok(),
  ).toBe(true);

  try {
    await openIntakeEntry(page);
    await page.getByLabel("购买单位", { exact: true }).fill("重复测试供应商");
    await page.getByLabel("批次号", { exact: true }).fill(batchNo);
    await page.getByLabel("采购单号", { exact: true }).fill(`PO-NEW-${suffix}`);
    await page.getByLabel("IACUC 编号", { exact: true }).fill("Z2026001");
    await page.getByLabel("项目负责人", { exact: true }).fill("重复测试负责人");
    await page.getByLabel("实验负责人", { exact: true }).fill("重复测试实验负责人");
    await page.getByLabel("数量（只）", { exact: true }).fill("5");
    await selectAntOptionByKeyboard(page, page.getByRole("combobox", { name: "房间", exact: true }));
    await setDate(page, "接收日期", "2026-10-21");

    await page.getByRole("button", { name: "保存待接收批次", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "发现重复待接收批次", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(batchNo);
    await expect(dialog).toContainText("批次号");
    await expect(dialog).not.toHaveClass(/ant-zoom-(appear|enter|leave)/);
    await page.screenshot({ path: testInfo.outputPath("intake-duplicate-batch.png"), animations: "disabled" });

    await dialog.getByRole("button", { name: "返回修改", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel("批次号", { exact: true })).toHaveValue(batchNo);
    expect(await duplicateIds()).toEqual([existingId]);

    await page.getByRole("button", { name: "保存待接收批次", exact: true }).click();
    await expect(dialog).toBeVisible();
    expect(
      (
        await page.request.post("/api/intake-batches", {
          data: {
            item: {
              id: laterId,
              batchNo,
              purchaseOrderNo: `PO-LATER-${suffix}`,
              iacuc: "Z2026001",
              supplier: "重复测试供应商",
              pi: "后续匹配负责人",
              owner: "后续匹配实验负责人",
              roomName: "8014",
              intakeDate: "2026-10-21",
              quantity: 5,
              finalCardCount: 1,
              species: "mouse",
              status: "pending_print",
              cards: [],
            },
          },
        })
      ).ok(),
    ).toBe(true);
    await dialog.getByRole("button", { name: "仍然保存", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("重复记录已更新，请重新核对后确认保存。");
    await expect(dialog).toContainText("后续匹配负责人");
    let releaseRequest = () => {};
    let requestStarted = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    await page.route("**/api/intake-batches", async (route) => {
      const body = route.request().postDataJSON() as { duplicateConfirmation?: string } | null;
      if (route.request().method() !== "POST" || !body?.duplicateConfirmation) {
        await route.fallback();
        return;
      }
      requestStarted();
      await gate;
      await route.fulfill({ status: 503, json: { error: "测试保存失败，请重试" } });
    });
    try {
      await dialog.getByRole("button", { name: "仍然保存", exact: true }).click();
      await started;
      await expect(dialog.getByRole("button", { name: /仍然保存$/ })).toHaveClass(/ant-btn-loading/);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
    } finally {
      releaseRequest();
    }
    await expect(dialog.getByRole("alert")).toContainText("测试保存失败，请重试");
    expect((await duplicateIds()).sort()).toEqual([existingId, laterId].sort());
    await page.unroute("**/api/intake-batches");
    const retrySave = dialog.getByRole("button", { name: /仍然保存$/ });
    await expect(retrySave).not.toHaveClass(/ant-btn-loading/);
    const confirmedSave = page.waitForResponse((response) => {
      if (new URL(response.url()).pathname !== "/api/intake-batches" || response.request().method() !== "POST")
        return false;
      const body = JSON.parse(response.request().postData() || "{}") as { duplicateConfirmation?: string };
      return Boolean(body.duplicateConfirmation);
    });
    await retrySave.click();
    const confirmedPayload = (await (await confirmedSave).json()) as { auditLogs?: Array<{ action?: string }> };
    expect(confirmedPayload).toEqual(
      expect.objectContaining({
        auditLogs: expect.arrayContaining([expect.objectContaining({ action: "intake_batch.duplicate_confirmed" })]),
      }),
    );
    await expect(page.getByText(`待接收批次 ${batchNo} 已保存，可继续录入下一批。`, { exact: true })).toBeVisible();
  } finally {
    await Promise.all((await duplicateIds()).map((id) => page.request.delete(`/api/intake-batches/${id}`)));
  }
});

test("editing excludes the current batch and asks for confirmation after changing to another batch number", async ({
  page,
}) => {
  const suffix = Date.now();
  const firstId = `batch-e2e-edit-duplicate-first-${suffix}`;
  const secondId = `batch-e2e-edit-duplicate-second-${suffix}`;
  const firstBatchNo = `E2E-EDIT-FIRST-${suffix}`;
  const secondBatchNo = `E2E-EDIT-SECOND-${suffix}`;
  const create = (id: string, batchNo: string) =>
    page.request.post("/api/intake-batches", {
      data: {
        item: {
          id,
          batchNo,
          iacuc: "Z2026001",
          supplier: "编辑重复测试供应商",
          pi: "编辑重复测试负责人",
          owner: "编辑重复测试实验负责人",
          roomName: "8014",
          intakeDate: "2026-10-21",
          quantity: 5,
          finalCardCount: 1,
          species: "mouse",
          status: "pending_print",
          cards: [],
        },
      },
    });

  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  expect((await create(firstId, firstBatchNo)).ok()).toBe(true);
  expect((await create(secondId, secondBatchNo)).ok()).toBe(true);

  try {
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    const row = page.locator("tr", { hasText: secondBatchNo }).first();
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑待接收批次", exact: true });
    await editor.getByLabel("项目负责人", { exact: true }).fill("编辑后负责人");
    await editor.getByRole("button", { name: "保存待接收批次", exact: true }).click();
    await expect(editor).toContainText("待接收批次已更新。");
    await expect(page.getByRole("dialog", { name: "发现重复待接收批次", exact: true })).toBeHidden();

    await editor.getByLabel("批次号", { exact: true }).fill(firstBatchNo);
    await editor.getByRole("button", { name: "保存待接收批次", exact: true }).click();
    const duplicate = page.getByRole("dialog", { name: "发现重复待接收批次", exact: true });
    await expect(duplicate).toContainText(firstBatchNo);
    const confirmedEdit = page.waitForResponse((response) => {
      if (!response.url().endsWith(`/api/intake-batches/${secondId}`) || response.request().method() !== "PUT")
        return false;
      const body = JSON.parse(response.request().postData() || "{}") as { duplicateConfirmation?: string };
      return Boolean(body.duplicateConfirmation);
    });
    await duplicate.getByRole("button", { name: "仍然保存", exact: true }).click();
    await confirmedEdit;
    await expect(duplicate).toBeHidden();
    const saved = await page.request.get(`/api/intake-batches/${secondId}`);
    expect(saved.ok()).toBe(true);
    expect(((await saved.json()) as { item: { batchNo: string } }).item.batchNo).toBe(firstBatchNo);
  } finally {
    await page.request.delete(`/api/intake-batches/${firstId}`);
    await page.request.delete(`/api/intake-batches/${secondId}`);
  }
});

test("printing a duplicate purchase order does not save or mark it printed until confirmation", async ({
  page,
}, testInfo) => {
  const suffix = Date.now();
  const existingId = `batch-e2e-print-duplicate-existing-${suffix}`;
  const batchNo = `E2E-PRINT-DUPLICATE-${suffix}`;
  const duplicatePurchaseOrderNo = `PO-PRINT-DUPLICATE-${suffix}`;
  const matchingBatches = async () => {
    const response = await page.request.get(
      `/api/intake-batches?${new URLSearchParams({
        limit: "100",
        offset: "0",
        columnFilters: JSON.stringify({ purchaseOrderNo: [duplicatePurchaseOrderNo] }),
      }).toString()}`,
    );
    const payload = (await response.json()) as { items: Array<{ id: string; batchNo: string; status: string }> };
    return payload.items.filter((item) => item.batchNo === batchNo || item.id === existingId);
  };

  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await page.request.post("/api/intake-batches", {
    data: {
      item: {
        id: existingId,
        batchNo: `${batchNo}-EXISTING`,
        purchaseOrderNo: duplicatePurchaseOrderNo,
        iacuc: "Z2026001",
        supplier: "打印重复测试供应商",
        pi: "打印重复测试负责人",
        owner: "打印重复测试实验负责人",
        roomName: "8014",
        intakeDate: "2026-10-21",
        quantity: 5,
        finalCardCount: 1,
        species: "mouse",
        status: "pending_print",
        cards: [],
      },
    },
  });

  try {
    await openIntakeEntry(page);
    await page.getByLabel("购买单位", { exact: true }).fill("打印重复测试供应商");
    await page.getByLabel("批次号", { exact: true }).fill(batchNo);
    await page.getByLabel("采购单号", { exact: true }).fill(duplicatePurchaseOrderNo);
    await page.getByLabel("IACUC 编号", { exact: true }).fill("Z2026001");
    await page.getByLabel("项目负责人", { exact: true }).fill("打印重复测试负责人");
    await page.getByLabel("实验负责人", { exact: true }).fill("打印重复测试实验负责人");
    await page.getByLabel("数量（只）", { exact: true }).fill("5");
    await selectAntOptionByKeyboard(page, page.getByRole("combobox", { name: "房间", exact: true }));
    await page.getByLabel("打印张数", { exact: true }).fill("1");
    await setDate(page, "接收日期", "2026-10-21");

    await page.getByRole("button", { name: "打印当前笼卡", exact: true }).click();
    const printConfirm = page.getByRole("dialog", { name: "补齐空白笼卡", exact: true });
    await expect(printConfirm).toBeVisible();
    await printConfirm.getByRole("button", { name: "直接打印", exact: true }).click();
    const duplicate = page.getByRole("dialog", { name: "发现重复待接收批次", exact: true });
    await expect(duplicate).toBeVisible();
    await expect(duplicate).toContainText("采购单号");
    await expect(duplicate).not.toHaveClass(/ant-zoom-(appear|enter|leave)/);
    await page.screenshot({ path: testInfo.outputPath("intake-duplicate-print.png"), animations: "disabled" });
    await duplicate.getByRole("button", { name: "返回修改", exact: true }).click();
    await expect.poll(matchingBatches).toEqual([expect.objectContaining({ id: existingId, status: "pending_print" })]);

    await page.getByRole("button", { name: "打印当前笼卡", exact: true }).click();
    await printConfirm.getByRole("button", { name: "直接打印", exact: true }).click();
    await duplicate.getByRole("button", { name: "仍然保存", exact: true }).click();
    await expect
      .poll(async () => (await matchingBatches()).some((item) => item.id !== existingId && item.status === "printed"))
      .toBe(true);
  } finally {
    await Promise.all((await matchingBatches()).map((item) => page.request.delete(`/api/intake-batches/${item.id}`)));
  }
});
