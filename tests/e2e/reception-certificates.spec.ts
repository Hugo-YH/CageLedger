import type { Locator, Page, Response } from "@playwright/test";
import { expect, openNavigationEntry, selectAntOptionByKeyboard, test } from "./fixtures";

function syntheticPdf() {
  const stream = "BT /F1 14 Tf 30 240 Td (Synthetic certificate CERT-E2E-001) Tj 0 -24 Td (ICR SPF Male 3) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name: "synthetic-certificate.pdf", mimeType: "application/pdf", buffer: Buffer.from(source, "ascii") };
}

async function receivedBatch(page: Page) {
  const health = await (await page.request.get("/api/health")).json();
  expect(health.database).toMatch(/cageledger-e2e-|CageLedger-validation\/reception-certificates-20261101\//);
  expect((await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } })).ok()).toBe(
    true,
  );
  const id = `reception-certificate-e2e-${Date.now()}`;
  const saved = await page.request.post("/api/intake-batches", {
    data: {
      item: {
        id,
        batchNo: id,
        iacuc: "Z-CERTIFICATE-UNMATCHED",
        supplier: "合成预约供应商",
        pi: "预约PI",
        owner: "预约负责人",
        roomName: "",
        intakeDate: "2026-11-01",
        quantity: 6,
        specification: "8w",
        finalCardCount: 0,
        intakePurpose: "direct_sampling",
        species: "mouse",
        strainRaw: "ICR",
        sex: "雄性",
        status: "pending_receipt",
        cards: [],
      },
    },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  expect((await page.request.post("/api/intake-batches/confirm-receipt", { data: { ids: [id] } })).ok()).toBe(true);
  const before = await (await page.request.get(`/api/intake-batches/${id}`)).json();
  const recognitionIds: string[] = [];
  await page.route("**/api/receptions/*/certificates/*/recognize", async (route) => {
    recognitionIds.push(route.request().postDataJSON().requestId);
    await route.fulfill({ status: 503, json: { error: "合成识别失败：原件与草稿应保留" } });
  });
  await page.goto("/app");
  await openNavigationEntry(page, "接收管理", "接收列表");
  const region = page.getByRole("region", { name: "接收批次列表" });
  const row = region.getByRole("row").filter({ has: page.getByText(id, { exact: true }) });
  await expect(row).toBeVisible();
  return { id, before, recognitionIds, region, row };
}

async function chooseOriginal(page: Page, row: Locator, id: string) {
  const response = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/receptions/${id}/certificates?`) && response.request().method() === "POST",
  );
  const chooser = page.waitForEvent("filechooser");
  await row.getByRole("button", { name: "合格证识别", exact: true }).click();
  await expect(page.getByRole("dialog", { name: `合格证与接收登记 · ${id}`, exact: true })).toBeHidden();
  await (await chooser).setFiles(syntheticPdf());
  return { response };
}

async function uploadOriginal(page: Page, id: string, responsePromise: Promise<Response>) {
  const drawer = page.getByRole("dialog", { name: `合格证与接收登记 · ${id}`, exact: true });
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBe(true);
  const attachment = (await response.json()).attachment;
  expect(attachment.pageCount).toBe(1);
  const image = drawer.getByRole("img", { name: "synthetic-certificate.pdf 首页原图", exact: true });
  await expect(image).toHaveAttribute("src", attachment.previewUrl);
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
    .toBe(true);
  await expect(drawer.getByRole("link", { name: "下载", exact: true })).toHaveAttribute("href", attachment.fileUrl);
  return drawer;
}

test("certificate original, manual confirmation and export use the real backend without changing the reservation", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { id, before, recognitionIds, region, row } = await receivedBatch(page);
  let releaseDetail = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseDetail = resolve;
  });
  let firstDetail = true;
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith(`/api/receptions/${id}/registration`)) writes += 1;
  });
  await page.route(`**/api/receptions/${id}/registration`, async (route) => {
    if (route.request().method() === "GET" && firstDetail) {
      firstDetail = false;
      await gate;
    }
    await route.fallback();
  });
  try {
    const { response } = await chooseOriginal(page, row, id);
    const opening = page.getByRole("dialog", { name: `合格证与接收登记 · ${id}`, exact: true });
    await expect(opening.getByRole("status", { name: "合格证详情正在加载", exact: true })).toBeVisible();
    await expect(region.getByRole("checkbox", { name: `选择 ${id}`, exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
    releaseDetail();
    const drawer = await uploadOriginal(page, id, response);
    await drawer.getByRole("button", { name: "添加手工明细", exact: true }).click();
    for (const [label, value] of [
      ["合格证编号", "CERT-E2E-001"],
      ["证载品系", "ICR"],
      ["等级", "SPF"],
      ["供应商", "合成出售单位"],
      ["登记规格", "6-8w"],
    ])
      await drawer.getByRole("textbox", { name: `明细1 ${label}`, exact: true }).fill(value);
    await selectAntOptionByKeyboard(page, drawer.getByRole("combobox", { name: "明细1 证载性别", exact: true }));
    const quantity = drawer.getByRole("spinbutton", { name: "明细1 证载数量", exact: true });
    const confirm = drawer.getByRole("button", { name: "核对并保存", exact: true });
    for (const value of ["", "0", "1.5"]) {
      await quantity.fill(value);
      await confirm.click();
      await expect(
        drawer.getByText("数量须为正整数；未知数量请核对原图后填写，0 行请删除", { exact: true }),
      ).toBeVisible();
      expect(writes).toBe(0);
    }
    await quantity.fill("13");
    await drawer.getByRole("button", { name: "补充性别和数量", exact: true }).click();
    await expect(drawer.getByRole("textbox", { name: "明细2 合格证编号", exact: true })).toHaveCount(0);
    const femaleQuantity = drawer.getByRole("spinbutton", { name: "明细2 证载数量", exact: true });
    await expect(femaleQuantity).toHaveValue("");
    await femaleQuantity.fill("8");
    await expect(drawer.getByText("合计 21 只", { exact: true })).toBeVisible();
    await confirm.click();
    await expect(drawer).toBeHidden();
    expect(writes).toBe(1);
    await expect(row.getByText("登记 21 只", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "查看/编辑", exact: true }).click();
    await expect(drawer.getByRole("textbox", { name: "明细1 合格证编号", exact: true })).toHaveValue("CERT-E2E-001");
    await expect(drawer.getByRole("spinbutton", { name: "明细1 证载数量", exact: true })).toHaveValue("13");
    await expect(drawer.getByRole("spinbutton", { name: "明细2 证载数量", exact: true })).toHaveValue("8");
    await expect(drawer.getByRole("textbox", { name: "明细2 合格证编号", exact: true })).toHaveCount(0);
    await drawer.getByRole("button", { name: "取消", exact: true }).click();
    const detail = await (await page.request.get(`/api/receptions/${id}/registration`)).json();
    expect(detail.registration.lines[0].runId).toBeNull();
    const preview = await page.request.post("/api/receptions/preview", {
      data: {
        ids: [id],
        expectedVersions: { [id]: detail.batch.updatedAt },
        expectedApplicationVersion: detail.applicationVersion,
        expectedRegistrationVersions: { [id]: detail.registration.updatedAt },
      },
    });
    expect(preview.ok(), await preview.text()).toBe(true);
    expect((await preview.json()).rows).toEqual([
      expect.objectContaining({
        qualityCertificateNo: "CERT-E2E-001",
        quantity: 13,
        quantitySource: "certificate_confirmed",
      }),
      expect.objectContaining({
        qualityCertificateNo: "CERT-E2E-001",
        quantity: 8,
        quantitySource: "certificate_confirmed",
      }),
    ]);
    expect(await (await page.request.get(`/api/intake-batches/${id}`)).json()).toEqual(before);
    expect(recognitionIds).toHaveLength(1);
  } finally {
    releaseDetail();
    await page.request.delete(`/api/intake-batches/${id}`);
  }
});

test("failed recognition retains the real uploaded original and current manual draft", async ({ page }) => {
  test.setTimeout(60_000);
  const { id, before, recognitionIds, row } = await receivedBatch(page);
  try {
    const { response } = await chooseOriginal(page, row, id);
    const drawer = await uploadOriginal(page, id, response);
    await expect(drawer.getByText("合成识别失败：原件与草稿应保留", { exact: true })).toBeVisible();
    await drawer.getByRole("button", { name: "添加手工明细", exact: true }).click();
    await drawer.getByRole("textbox", { name: "明细1 合格证编号", exact: true }).fill("DRAFT-KEEP");
    await drawer.getByRole("spinbutton", { name: "明细1 证载数量", exact: true }).fill("7");
    await drawer.getByRole("button", { name: "识别", exact: true }).click();
    const keepDraft = page.getByRole("button", { name: "保留当前明细", exact: true });
    await keepDraft.click();
    await expect(keepDraft).toBeHidden();
    expect(recognitionIds).toHaveLength(1);
    await expect(drawer.getByRole("textbox", { name: "明细1 合格证编号", exact: true })).toHaveValue("DRAFT-KEEP");
    await drawer.getByRole("button", { name: "识别", exact: true }).click();
    await page.getByRole("button", { name: "重新识别并替换", exact: true }).click();
    await expect.poll(() => recognitionIds.length).toBe(2);
    expect(recognitionIds[0]).toBe(recognitionIds[1]);
    await expect(drawer.getByRole("textbox", { name: "明细1 合格证编号", exact: true })).toHaveValue("DRAFT-KEEP");
    await expect(drawer.getByRole("spinbutton", { name: "明细1 证载数量", exact: true })).toHaveValue("7");
    await expect(drawer.getByRole("img", { name: "synthetic-certificate.pdf 首页原图", exact: true })).toBeVisible();
    const detail = await (await page.request.get(`/api/receptions/${id}/registration`)).json();
    expect(detail.attachments).toHaveLength(1);
    expect(detail.registration).toBeNull();
    expect(detail.runs).toEqual([]);
    expect(await (await page.request.get(`/api/intake-batches/${id}`)).json()).toEqual(before);
  } finally {
    await page.request.delete(`/api/intake-batches/${id}`);
  }
});

test("multi-page recognition shows the submitted pages and permits an explicit all-page retry", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  const { id, before, row } = await receivedBatch(page);
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const kids: string[] = [];
  for (const [width, height] of [
    [595, 842],
    [595, 842],
    [4032, 2268],
    [4032, 2268],
  ]) {
    const number = objects.length + 1;
    kids.push(`${number} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents ${number + 1} 0 R >>`,
      "<< /Length 0 >>\nstream\n\nendstream",
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count 4 >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const uploaded = await page.request.post(
    `/api/receptions/${id}/certificates?expectedBatchUpdatedAt=${encodeURIComponent(before.item.updatedAt)}`,
    { multipart: { file: { name: "four-pages.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) } } },
  );
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  const attachment = (await uploaded.json()).attachment;
  expect(attachment.pageCount).toBe(4);
  const requests: Array<{ requestId: string; includeAllPages: boolean }> = [];
  await page.unroute("**/api/receptions/*/certificates/*/recognize");
  await page.route("**/api/receptions/*/certificates/*/recognize", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const runId = `multi-${requests.length}`;
    await route.fulfill({
      json: {
        run: {
          id: runId,
          attachmentId: attachment.id,
          batchId: id,
          sourceBatchUpdatedAt: before.item.updatedAt,
          status: "completed",
          error: "",
          model: "synthetic",
          createdAt: "2026-11-02",
          updatedAt: "2026-11-02",
          result: {
            warnings: [],
            pageSelection: {
              totalPages: 4,
              selectedPages: body.includeAllPages ? [1, 2, 3, 4] : [1, 2],
              skippedPhotoPages: body.includeAllPages ? [] : [3, 4],
              mode: body.includeAllPages ? "all" : "auto",
            },
            lines: [
              {
                id: `line-${runId}`,
                attachmentId: attachment.id,
                runId,
                certificateIndex: 1,
                certificateLineIndex: 1,
                certificateNo: "MULTI-CERT",
                certificateStrain: "ICR",
                grade: "SPF",
                supplier: "合成供应商",
                sex: "雄性",
                quantity: 6,
                weightRaw: "",
                ageRaw: "8w",
                specification: "8w",
                receiptId: null,
                experimentCertificateNo: "",
                notes: "",
              },
            ],
          },
        },
      },
    });
  });
  await page.reload();
  await openNavigationEntry(page, "接收管理", "接收列表");
  await row.getByRole("button", { name: "核对登记", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `合格证与接收登记 · ${id}`, exact: true });
  await expect(dialog.getByRole("radio", { name: "自动筛选合格证页", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "识别", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(dialog.getByText("第 1、2 页", { exact: false }).first()).toBeVisible();
  await expect(dialog.getByText(/第 3、4 页/)).toBeVisible();
  expect(requests[0].includeAllPages).toBe(false);
  await dialog.getByRole("radio", { name: "全部页面", exact: true }).check();
  await dialog.getByRole("button", { name: "识别", exact: true }).click();
  await page.getByRole("button", { name: "重新识别并替换", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].includeAllPages).toBe(true);
  expect(requests[1].requestId).not.toBe(requests[0].requestId);
  await expect(dialog.getByText(/第 1、2、3、4 页/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole("radio", { name: "全部页面", exact: true })).toBeChecked();
  expect(await dialog.evaluate((node) => node.getBoundingClientRect().width <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("certificate-multi-page-mobile.png"), animations: "disabled" });
  expect(await (await page.request.get(`/api/intake-batches/${id}`)).json()).toEqual(before);
});
