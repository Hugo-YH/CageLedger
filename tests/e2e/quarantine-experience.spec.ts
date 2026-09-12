import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, openNavigationEntry, test } from "./fixtures";
import type { QuarantineMethod, QuarantineTest } from "../../src/contracts/quarantine";

const methodLabels = {
  parasite: "寄生虫检测",
  elisa_mouse: "ELISA检测（小鼠）",
  elisa_rat: "ELISA检测（大鼠）",
  pcr: "PCR检测",
};

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeHidden();
}

async function seed(page: Page, method: QuarantineMethod = "elisa_mouse", sampleCount = 1, projectCount = 2) {
  const batchId = randomUUID();
  const batchName = `体验回归-${batchId}`;
  const sources = Array.from({ length: sampleCount }, (_, index) => ({
    id: `source-${index}`,
    supplier: "体验测试供应商",
    species: "mouse",
    pi: `课题组${index + 1}`,
    owner: "检测员",
  }));
  const batchResponse = await page.request.post("/api/quarantine/batches", {
    data: { item: { id: batchId, name: batchName, sources } },
  });
  expect(batchResponse.ok(), await batchResponse.text()).toBe(true);
  const record: QuarantineTest = {
    id: randomUUID(),
    batchId,
    method,
    reportFormVersion: 2,
    reportMaterial: "血清",
    reportSpecimenState: "液体",
    samplingDate: "",
    testDate: "",
    conclusion: "",
    notes: "",
    state: "draft",
    updatedAt: "",
    retestOf: "",
    correctionOf: "",
    samples: [],
    projects: Array.from({ length: projectCount }, (_, index) => ({
      id: `project-${index}`,
      name: `项目${index + 1}`,
      kit: "",
      lot: "",
      sampleIds: [],
      results: {},
      wells: {},
      nc: "",
      pc: "",
    })),
  };
  record.samplingDate = "2026-09-11";
  record.testDate = "2026-09-12";
  record.samples = sources.map((source, index) => ({
    id: `sample-${index}`,
    number: String(index + 1),
    material: record.reportMaterial ?? "",
    specimenState: "液体",
    poolCount: 1,
    portionCount: 1,
    sourceIds: [source.id],
  }));
  record.projects = record.projects.map((project) => ({
    ...project,
    kit: "试剂盒",
    lot: "LOT20260912",
    sampleIds: record.samples.map((sample) => sample.id),
    results: Object.fromEntries(record.samples.map((sample) => [sample.id, "negative" as const])),
    nc: "negative",
    pc: "positive",
  }));
  const saved = await page.request.post("/api/quarantine/tests", { data: { item: record } });
  expect(saved.ok(), await saved.text()).toBe(true);
  return { batchId, batchName, record: (await saved.json()).item };
}

async function openRecord(page: Page, batchName: string, method: QuarantineMethod) {
  await openNavigationEntry(page, "检疫管理", method.startsWith("elisa") ? "ELISA检测" : methodLabels[method]);
  await page.getByRole("row").filter({ hasText: batchName }).getByRole("button", { name: "查看检测记录" }).click();
  await page.getByRole("tab", { name: `${methodLabels[method]} · 2026-09-12 · 草稿`, exact: true }).click();
}

test("batch save locks its submitted draft and recovers from failure", async ({ page }) => {
  await login(page);
  const { batchId, batchName } = await seed(page);
  await openNavigationEntry(page, "检疫管理", "检疫批次");
  await page.getByRole("tab", { name: "检疫批次列表", exact: true }).click();
  await page.getByRole("row").filter({ hasText: batchName }).getByRole("button", { name: "编辑", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑检疫批次" });
  const notes = dialog.getByRole("textbox", { name: "检疫批次备注", exact: true });
  await notes.fill("保留当前批次备注");
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let failSave = true;
  await page.route(`**/api/quarantine/batches/${batchId}`, async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    await saveGate;
    return failSave ? route.fulfill({ status: 500, json: { error: "批次保存暂时失败" } }) : route.fallback();
  });
  await dialog.getByRole("button", { name: "保存检疫批次", exact: true }).click();
  await expect(notes).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  releaseSave();
  await expect(dialog.getByRole("alert")).toContainText("批次保存暂时失败");
  await expect(notes).toBeEnabled();
  await expect(notes).toHaveValue("保留当前批次备注");
  failSave = false;
  await dialog.getByRole("button", { name: "保存检疫批次", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("备注：保留当前批次备注", { exact: true })).toBeVisible();
});

test("quarantine detail and catalog failures retain navigation and retry", async ({ page }) => {
  await login(page);
  const { batchId, batchName } = await seed(page);
  let failDetail = true;
  let failCatalog = true;
  await page.route(`**/api/quarantine/batches/${batchId}`, (route) =>
    failDetail ? route.fulfill({ status: 500, json: { error: "批次详情暂时不可用" } }) : route.fallback(),
  );
  await page.route("**/api/quarantine/catalog", (route) =>
    failCatalog ? route.fulfill({ status: 500, json: { error: "检测目录暂时不可用" } }) : route.fallback(),
  );
  await openNavigationEntry(page, "检疫管理", "ELISA检测");
  await page.getByRole("row").filter({ hasText: batchName }).getByRole("button", { name: "查看检测记录" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "批次详情暂时不可用" })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回列表", exact: true })).toBeVisible();
  failDetail = false;
  await page.getByRole("alert").filter({ hasText: "批次详情暂时不可用" }).getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("group", { name: "检疫批次详情操作", exact: true })).toContainText(batchName);
  await expect(page.getByRole("button", { name: "新建检测记录", exact: true })).toBeDisabled();
  failCatalog = false;
  await page.getByRole("alert").filter({ hasText: "检测目录暂时不可用" }).getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("button", { name: "新建检测记录", exact: true })).toBeEnabled();
});

for (const method of ["parasite", "elisa_mouse", "pcr"] as const) {
  test(`${method} record preserves failed save and reports upload and download progress`, async ({ page }) => {
    test.setTimeout(60_000);
    await login(page);
    const { batchName, record } = await seed(page, method);
    await openRecord(page, batchName, method);
    let releaseDownload!: () => void;
    const downloadGate = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    let failDownload = true;
    let downloads = 0;
    await page.route(`**/api/quarantine/tests/${record.id}/preview`, async (route) => {
      downloads += 1;
      await downloadGate;
      await route.fulfill(
        failDownload
          ? { status: 500, json: { error: "测试下载失败" } }
          : {
              status: 200,
              contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              headers: { "Content-Disposition": 'attachment; filename="report.docx"' },
              body: "test download",
            },
      );
    });
    await page.getByRole("button", { name: "下载Word草稿", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "正在生成 Word 草稿" })).toBeVisible();
    await expect(page.getByRole("button", { name: "下载Word草稿", exact: true })).toHaveClass(/ant-btn-loading/);
    expect(downloads).toBe(1);
    releaseDownload();
    await expect(page.getByRole("alert").filter({ hasText: "测试下载失败" })).toBeVisible();
    failDownload = false;
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "重试下载", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("report.docx");
    await expect(page.getByRole("status").filter({ hasText: "已下载 report.docx" })).toBeVisible();
    await page.getByRole("button", { name: "编辑检测", exact: true }).click();
    const material = page.getByRole("textbox", { name: "样品名称", exact: true });
    await material.fill("测试材料");
    let failSave = true;
    await page.route(`**/api/quarantine/tests/${record.id}`, (route) =>
      failSave && route.request().method() === "PUT"
        ? route.fulfill({ status: 500, json: { error: "测试保存失败" } })
        : route.fallback(),
    );
    await page.getByRole("button", { name: "保存检测草稿", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "测试保存失败" })).toBeVisible();
    await expect(material).toHaveValue("测试材料");
    await expect(material).toBeEnabled();
    failSave = false;
    await page.getByRole("button", { name: "保存检测草稿", exact: true }).click();
    await expect(page.getByText("当前内容已保存", { exact: true })).toBeVisible();
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    let failUpload = true;
    await page.route(`**/api/quarantine/tests/${record.id}/attachments?**`, async (route) => {
      await uploadGate;
      if (failUpload) await route.fulfill({ status: 500, json: { error: "测试上传失败" } });
      else await route.fallback();
    });
    const file = {
      name: "record.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    };
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(page.getByRole("status").filter({ hasText: "正在保存草稿并上传原始资料" })).toBeVisible();
    await expect(material).toBeDisabled();
    await expect(page.getByRole("button", { name: "上传原始资料", exact: true })).toHaveClass(/ant-btn-loading/);
    releaseUpload();
    await expect(page.getByRole("alert").filter({ hasText: "测试上传失败" })).toBeVisible();
    await expect(material).toHaveValue("测试材料");
    await expect(material).toBeEnabled();
    failUpload = false;
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(page.getByRole("status").filter({ hasText: "已上传 record.png" })).toBeVisible();
    await page.getByRole("textbox", { name: "record.png 图注", exact: true }).fill("已核对原始资料");
    await page.getByRole("button", { name: "保存图片信息", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "已保存 record.png 图片信息" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "record.png 图注", exact: true })).toHaveValue("已核对原始资料");
  });
}

test("supplier history retains populated results while filtering and can retry and open reports", async ({
  page,
}, testInfo) => {
  await login(page);
  const { batchName, batchId, record } = await seed(page);
  const detail = await (await page.request.get(`/api/quarantine/batches/${batchId}`)).json();
  const issued = await page.request.post(`/api/quarantine/tests/${record.id}/issue`, {
    data: { expectedUpdatedAt: record.updatedAt, expectedBatchUpdatedAt: detail.item.updatedAt },
  });
  expect(issued.ok(), await issued.text()).toBe(true);
  await openNavigationEntry(page, "检疫管理", "检疫报告");
  let failHistory = false;
  let releaseHistory!: () => void;
  const historyGate = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  await page.route("**/api/quarantine/suppliers?**", async (route) => {
    if (!failHistory) return route.fallback();
    await historyGate;
    return route.fulfill({ status: 500, json: { error: "供应商历史暂时不可用" } });
  });
  await page.getByRole("tab", { name: "供应商历史", exact: true }).click();
  const supplier = page.getByRole("cell", { name: "体验测试供应商", exact: true });
  await expect(supplier.first()).toBeVisible();
  failHistory = true;
  const search = page.getByRole("searchbox", { name: "查询供应商", exact: true });
  await search.fill("体验测试供应商");
  await search.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "正在更新" })).toBeVisible();
  await expect(supplier.first()).toBeVisible();
  await expect(search).toBeEnabled();
  releaseHistory();
  await expect(page.getByRole("alert").filter({ hasText: "供应商历史暂时不可用" })).toBeVisible();
  failHistory = false;
  await page
    .getByRole("alert")
    .filter({ hasText: "供应商历史暂时不可用" })
    .getByRole("button", { name: "重试" })
    .click();
  await expect(supplier.first()).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    const metrics = await page.locator('[data-feature="quarantine"]').evaluate((element) => {
      const expand = element.querySelector(".ant-table-row-expand-icon")!;
      return {
        display: getComputedStyle(element).display,
        gap: getComputedStyle(element).gap,
        minWidth: getComputedStyle(element).minWidth,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        expandButton: {
          width: expand.getBoundingClientRect().width,
          height: expand.getBoundingClientRect().height,
          minHeight: getComputedStyle(expand).minHeight,
          padding: getComputedStyle(expand).padding,
        },
      };
    });
    expect(metrics.pageOverflow).toBe(false);
    expect(metrics.expandButton.height).toBe(metrics.expandButton.width);
    await testInfo.attach(`supplier-history-${width}-style`, {
      body: JSON.stringify(metrics),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath(`supplier-history-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await supplier.first().locator("..").getByRole("button", { name: "展开行" }).click();
  await page.getByRole("button", { name: `${batchName} · 2026-09-12`, exact: true }).click();
  await expect(page.getByRole("group", { name: "检疫批次详情操作", exact: true })).toContainText(batchName);
  await page.getByRole("tab", { name: "ELISA检测（小鼠） · 2026-09-12 · 已出具", exact: true }).click();
  await expect(page.getByText("已出具报告版本", { exact: true })).toBeVisible();
});

test("quarantine large record input and four viewport evidence", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await login(page);
  const { batchName } = await seed(page, "elisa_mouse", 24, 8);
  await openRecord(page, batchName, "elisa_mouse");
  await page.getByRole("button", { name: "编辑检测", exact: true }).click();
  const material = page.getByRole("textbox", { name: "样品名称", exact: true });
  await expect(material).toHaveValue("血清");
  const inputMs: number[] = [];
  for (const value of ["血清A", "血清AB", "血清ABC", "血清ABCD", "血清ABCDE"]) {
    const started = performance.now();
    await material.fill(value);
    await expect(material).toHaveValue(value);
    await expect(material).toBeFocused();
    inputMs.push(performance.now() - started);
  }
  await testInfo.attach("large-record-input", {
    body: JSON.stringify({ samples: 24, projects: 8, resultCells: 208, inputMs }),
    contentType: "application/json",
  });
  for (const [width, height] of [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(material).toHaveValue("血清ABCDE");
    const metrics = await page.locator(".quarantine-report-workspace").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        display: style.display,
        grid: style.gridTemplateColumns,
        gap: style.gap,
        minWidth: style.minWidth,
        position: style.position,
        zIndex: style.zIndex,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        samplesOverflow:
          element.querySelector(".quarantine-sample-table .ant-table-content")!.scrollWidth >
          element.querySelector(".quarantine-sample-table .ant-table-content")!.clientWidth,
        controls: [".ant-picker", ".ant-input", ".ant-select"].map((selector) => {
          const control = element.querySelector(selector)!;
          return { selector, height: control.getBoundingClientRect().height };
        }),
      };
    });
    expect(metrics.pageOverflow).toBe(false);
    expect(metrics.samplesOverflow).toBe(true);
    await testInfo.attach(`large-record-${width}-style`, {
      body: JSON.stringify(metrics),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath(`large-record-${width}.png`) });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(material).toHaveValue("血清ABCDE");
  await expect(material).toBeFocused();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(material).toHaveValue("血清ABCDE");
  await expect(material).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "查看报告预览", exact: true }).click();
  await expect(page.locator(".quarantine-report-preview")).toContainText("血清ABCDE");
  await page.getByRole("button", { name: "继续填写", exact: true }).click();
  await expect(material).toHaveValue("血清ABCDE");
});
