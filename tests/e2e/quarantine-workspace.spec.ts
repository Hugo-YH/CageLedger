import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, openNavigationEntry, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function setup(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeHidden();
  const id = randomUUID();
  const batchResponse = await page.request.post("/api/quarantine/batches", {
    data: {
      item: {
        id,
        name: `工作台-${id}`,
        sources: [{ id: "source", supplier: "工作台供应商", species: "mouse", pi: "回归课题组" }],
      },
    },
  });
  expect(batchResponse.ok()).toBe(true);
  const batch = (await batchResponse.json()).item;
  const response = await page.request.post("/api/quarantine/tests", {
    data: {
      item: {
        id: randomUUID(),
        batchId: id,
        method: "parasite",
        reportFormVersion: 2,
        reportMaterial: "皮毛",
        reportSpecimenState: "固体",
        samplingDate: "2026-09-15",
        testDate: "2026-09-16",
        samples: [
          { id: "sample", number: "1", material: "皮毛", sourceIds: ["source"], poolCount: 1, portionCount: 1 },
        ],
        projects: [
          {
            id: "project",
            name: "体内寄生虫",
            kit: "",
            lot: "",
            sampleIds: ["sample"],
            results: { sample: "negative" },
            nc: "",
            pc: "",
            wells: {},
          },
        ],
      },
    },
  });
  expect(response.ok()).toBe(true);
  return { batch, record: (await response.json()).item };
}
async function open(page: Page, name: string) {
  await openNavigationEntry(page, "检疫管理", "寄生虫检测");
  const search = page.getByRole("searchbox", { name: "搜索检测记录" });
  await search.fill(name);
  await search.press("Enter");
  await page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "查看检测记录" }).click();
}

test("quarantine redesigned workspaces retain accessible Ant semantics", async ({ page }) => {
  const { batch } = await setup(page);
  const check = async (selector: string) => {
    const result = await new AxeBuilder({ page }).include(selector).analyze();
    expect(result.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  };
  await openNavigationEntry(page, "检疫管理", "寄生虫检测");
  await expect(page.getByRole("button", { name: "查看检测记录" }).first()).toBeVisible();
  await check('[data-feature="quarantine"]');
  await open(page, batch.name);
  await expect(page.getByRole("button", { name: "新建检测记录", exact: true })).toBeEnabled();
  await check('[data-feature="quarantine"]');
  await page.getByRole("button", { name: "编辑检测", exact: true }).click();
  await check('[data-feature="quarantine"]');
  await page.getByRole("button", { name: "返回批次", exact: true }).click();
  await openNavigationEntry(page, "检疫管理", "检疫批次");
  await page.getByRole("button", { name: "新建检疫批次", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await check('[role="dialog"]');
});

test("quarantine draft stays protected on navigation and stale save", async ({ page }) => {
  const { batch, record } = await setup(page);
  await open(page, batch.name);
  await page.getByRole("button", { name: "编辑检测", exact: true }).click();
  const material = page.getByRole("textbox", { name: "样品名称", exact: true });
  await material.fill("未保存的材料");
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await openNavigationEntry(page, "检疫管理", "ELISA检测");
  const confirm = page.getByRole("dialog", { name: "离开并放弃未保存的修改？" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "继续编辑" }).click();
  await expect(material).toHaveValue("未保存的材料");
  await page.route(`**/api/quarantine/tests/${record.id}`, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 409, json: { error: "记录已更新，请刷新后重新编辑" } })
      : route.fallback(),
  );
  await page.getByRole("button", { name: "保存检测草稿" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "记录已更新" })).toBeVisible();
  await expect(material).toHaveValue("未保存的材料");
  await page.getByRole("button", { name: "返回批次" }).click();
  await confirm.getByRole("button", { name: "放弃修改并离开" }).click();
  const detail = await (await page.request.get(`/api/quarantine/batches/${batch.id}`)).json();
  expect(detail.tests.find((value: { id: string }) => value.id === record.id).reportMaterial).toBe("皮毛");
});

test("quarantine returns to the newly saved record within an existing batch", async ({ page }) => {
  const { batch } = await setup(page);
  await open(page, batch.name);
  await page.getByRole("button", { name: "新建检测记录", exact: true }).click();
  await page.getByRole("textbox", { name: "样品名称", exact: true }).fill("第二份检测的材料");
  await page.getByRole("button", { name: "保存检测草稿", exact: true }).click();
  await expect(page.getByText("当前内容已保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回批次", exact: true }).click();
  await expect(page.getByText("第二份检测的材料", { exact: true })).toBeVisible();
  const detail = await (await page.request.get(`/api/quarantine/batches/${batch.id}`)).json();
  expect(detail.tests).toHaveLength(2);
});

test("quarantine section navigation and unsaved attachment metadata are protected", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { batch } = await setup(page);
  await open(page, batch.name);
  await page.getByRole("button", { name: "编辑检测", exact: true }).click();
  await page.getByRole("link", { name: "原始资料", exact: true }).click();
  const section = page
    .locator(".quarantine-record-section")
    .filter({ has: page.getByText("原始资料", { exact: true }) });
  await expect
    .poll(async () => {
      const target = await section.boundingBox();
      const bar = await page.getByRole("group", { name: "检测记录编辑操作", exact: true }).boundingBox();
      return Boolean(target && bar && target.y >= bar.y + bar.height - 1 && target.y < 900);
    })
    .toBe(true);
  expect(new URL(page.url()).hash).toBe("");
  await page.locator('input[type="file"]').setInputFiles({
    name: "metadata.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  const caption = page.getByRole("textbox", { name: "metadata.png 图注" });
  await caption.fill("待保存的图注");
  await page.getByRole("button", { name: "返回批次", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "离开并放弃未保存的修改？" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "继续编辑" }).click();
  await expect(caption).toHaveValue("待保存的图注");
  await page.getByRole("button", { name: "保存图片信息", exact: true }).click();
  await expect(page.getByText("图片信息尚未保存", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "返回批次", exact: true }).click();
  await expect(confirm).toBeHidden();
  const detail = await (await page.request.get(`/api/quarantine/batches/${batch.id}`)).json();
  expect(detail.attachments[0].caption).toBe("待保存的图注");
});

test("quarantine worklists show persisted records, reports and scoped activity", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const { batch, record } = await setup(page);
  const records = await (
    await page.request.get(`/api/quarantine/records?search=${encodeURIComponent(batch.name)}&state=draft`)
  ).json();
  expect(records.page.total).toBe(1);
  const prior = await (
    await page.request.get(`/api/quarantine/reports?search=${encodeURIComponent(batch.name)}`)
  ).json();
  expect(prior.items).toHaveLength(0);
  await open(page, batch.name);
  await page.getByRole("tab", { name: "操作历史", exact: true }).click();
  await expect(page.getByText("保存检测", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "出具报告", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认出具", exact: true }).click();
  await expect(page.getByRole("button", { name: "创建更正草稿", exact: true })).toBeVisible({ timeout: 60_000 });
  await openNavigationEntry(page, "检疫管理", "检疫报告");
  const search = page.getByRole("searchbox", { name: "搜索检测记录" });
  await search.fill(batch.name);
  await search.press("Enter");
  const row = page.getByRole("row").filter({ hasText: batch.name });
  await expect(row).toContainText("第 1 版");
  for (const [width, height] of [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const path = testInfo.outputPath(`report-ledger-${width}.png`);
    await page.screenshot({ path, animations: "disabled" });
    await testInfo.attach(`report-ledger-${width}`, { path, contentType: "image/png" });
  }
  await row.getByRole("button", { name: "查看报告" }).click();
  await expect(page.getByText("已出具报告版本", { exact: true })).toBeVisible();
  const reports = await (
    await page.request.get(`/api/quarantine/reports?search=${encodeURIComponent(batch.name)}`)
  ).json();
  expect(reports.items[0].testId).toBe(record.id);
  expect(reports.items[0].snapshot).toBeUndefined();
  const response = await page.request.get(`/api/quarantine/reports/${reports.items[0].id}`);
  expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
});
