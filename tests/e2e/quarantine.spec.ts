import { randomUUID } from "node:crypto";
import { ensureTestInfrastructure, expect, openNavigationEntry, test } from "./fixtures";
import type { Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeHidden();
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1180, height: 900 },
  { width: 760, height: 900 },
  { width: 844, height: 390 },
  { width: 390, height: 844 },
]) {
  test.describe(`quarantine ${size.width}`, () => {
    test.use({ hasTouch: size.width === 390 });
    test("create manual sentinel batch with accessible reduced-motion overlays", async ({ page }, testInfo) => {
      await page.setViewportSize(size);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() =>
        Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true }),
      );
      await login(page);
      await openNavigationEntry(page, "检疫管理", "检疫报告");
      await expect(page.getByRole("combobox", { name: "检疫池范围" })).toBeVisible();
      const poolStyle = await page.locator('section[data-feature="quarantine"]').evaluate((el) => ({
        display: getComputedStyle(el).display,
        gap: getComputedStyle(el).gap,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      expect(poolStyle.overflow).toBe(false);
      await testInfo.attach("pool-computed-style", {
        body: JSON.stringify(poolStyle),
        contentType: "application/json",
      });
      await page.screenshot({ path: testInfo.outputPath("pool.png"), fullPage: true });
      await page.getByRole("button", { name: "新建检疫批次", exact: true }).click();
      const batchName = `哨兵鼠检疫-${randomUUID()}`;
      await page.getByRole("textbox", { name: "检疫批次名称", exact: true }).fill(batchName);
      await page.getByRole("combobox", { name: "手工供应商", exact: true }).fill("测试供应商");
      await page.getByRole("button", { name: "添加手工来源" }).click();
      await expect(page.getByText("已选覆盖来源（1）")).toBeVisible();
      await page.getByRole("button", { name: "保存检疫批次" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await openNavigationEntry(page, "检疫管理", "寄生虫检测");
      await page.getByRole("button", { name: "新建寄生虫检测记录", exact: true }).click();
      await page.getByRole("searchbox", { name: "搜索待填写检疫批次" }).fill(batchName);
      await page.getByRole("searchbox", { name: "搜索待填写检疫批次" }).press("Enter");
      await page.getByRole("row").filter({ hasText: batchName }).getByRole("button", { name: "选择并填写" }).click();
      await page.getByRole("button", { name: /添加样本/ }).click();
      await page.getByRole("combobox", { name: "混样来源 1", exact: true }).click();
      await expect(page.locator(".ant-select-dropdown").filter({ visible: true })).toBeInViewport();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Escape");
      const root = page.locator('section[data-feature="quarantine"]');
      const style = await root.evaluate((element) => {
        const computed = getComputedStyle(element);
        return {
          display: computed.display,
          minWidth: computed.minWidth,
          gap: computed.gap,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          wide: [...document.querySelectorAll("body *")]
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return rect.right > window.innerWidth + 1 || rect.left < -1;
            })
            .slice(0, 8)
            .map((node) => ({
              tag: node.tagName,
              className: node.className,
              left: Math.round(node.getBoundingClientRect().left),
              right: Math.round(node.getBoundingClientRect().right),
            })),
        };
      });
      expect(style.overflow).toBe(false);
      await testInfo.attach("computed-style", { body: JSON.stringify(style), contentType: "application/json" });
      const reportStyle = await page.locator(".quarantine-report-workspace").evaluate((element) => ({
        display: getComputedStyle(element).display,
        columns: getComputedStyle(element).gridTemplateColumns,
        paperBackground: getComputedStyle(element.querySelector(".quarantine-report-paper")!).backgroundColor,
        outlineDisplay: getComputedStyle(element.querySelector(".quarantine-report-outline")!).display,
        toolbarPosition: getComputedStyle(document.querySelector(".quarantine-report-workbar")!).position,
      }));
      expect(reportStyle.paperBackground).not.toBe("rgba(0, 0, 0, 0)");
      expect(reportStyle.outlineDisplay).toBe(size.width <= 760 ? "none" : "flex");
      expect(reportStyle.toolbarPosition).toBe(size.width <= 760 ? "static" : "sticky");
      await testInfo.attach("report-computed-style", {
        body: JSON.stringify(reportStyle),
        contentType: "application/json",
      });
      await page.screenshot({ path: testInfo.outputPath("quarantine.png"), fullPage: true });
      await page.getByRole("button", { name: "保存检测草稿" }).click();
      await expect(page.getByText("当前内容已保存", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "上传原始资料" })).toBeEnabled();
      await page
        .locator('input[type="file"]')
        .setInputFiles({ name: "原始记录.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n") });
      await expect(page.getByRole("button", { name: "原始记录.pdf" })).toBeVisible();
      await page.getByRole("button", { name: "查看报告预览", exact: true }).click();
      await expect(page.getByRole("button", { name: "继续填写", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "上传原始资料" })).toHaveCount(0);
      await expect(page.locator(".quarantine-report-paper")).toHaveClass(/quarantine-report-preview/);
    });
  });
}

test("quarantine APIs authenticate, audit and preserve report versions", async ({ page, playwright }) => {
  const anon = await playwright.request.newContext({ baseURL: "http://127.0.0.1:5183" });
  expect((await anon.get("/api/quarantine/batches")).status()).toBe(401);
  await anon.dispose();
  await login(page);
  const batchId = randomUUID();
  const saved = await page.request.post("/api/quarantine/batches", {
    data: { item: { id: batchId, name: "API检疫", sources: [{ id: "source", supplier: "供应商", species: "小鼠" }] } },
  });
  expect(saved.ok()).toBe(true);
  const batch = (await saved.json()).item;
  const response = await page.request.post("/api/quarantine/tests", {
    data: {
      item: {
        id: randomUUID(),
        batchId,
        method: "parasite",
        samplingDate: "2026-09-02",
        testDate: "2026-09-03",
        conclusion: "抽检无异常",
        samples: [{ id: "s", number: "1", material: "皮毛", poolCount: 1, portionCount: 2, sourceIds: ["source"] }],
        projects: [{ id: "p", name: "体外寄生虫", sampleIds: ["s"], results: { s: "negative" }, wells: {} }],
      },
    },
  });
  expect(response.ok()).toBe(true);
  const record = (await response.json()).item;
  const conflict = await page.request.put(`/api/quarantine/tests/${record.id}`, {
    data: { item: record, expectedUpdatedAt: "stale" },
  });
  expect(conflict.status()).toBe(409);
  const issued = await page.request.post(`/api/quarantine/tests/${record.id}/issue`, {
    data: { expectedUpdatedAt: record.updatedAt, expectedBatchUpdatedAt: batch.updatedAt },
  });
  expect(issued.ok()).toBe(true);
  const report = (await issued.json()).item;
  const download = await page.request.get(`/api/quarantine/reports/${report.id}`);
  expect(download.headers()["content-type"]).toContain("wordprocessingml");
  expect((await download.body()).subarray(0, 2).toString()).toBe("PK");
  const detail = await (await page.request.get(`/api/quarantine/batches/${batchId}`)).json();
  expect(detail.reports).toHaveLength(1);
  expect(detail.tests[0].state).toBe("issued");
  const correction = await page.request.post(`/api/quarantine/tests/${record.id}/correction`, {
    data: { id: randomUUID(), expectedUpdatedAt: detail.tests[0].updatedAt },
  });
  expect(correction.ok()).toBe(true);
  const audits = await page.request.get("/api/audit-events?limit=100");
  expect(JSON.stringify(await audits.json())).toContain("quarantine.report_issued");
});

test("room administrator without assigned rooms can manage quarantine", async ({ page, browser }) => {
  await login(page);
  const username = `quarantine-${randomUUID()}`;
  const created = await page.request.post("/api/users", {
    data: { username, password: "Quarantine-test-123", displayName: "普通检测员", role: "room_admin", roomIds: [] },
  });
  expect(created.ok()).toBe(true);
  const context = await browser.newContext();
  const regular = await context.newPage();
  await regular.route("**/api/release-announcements/*", (route) => route.fulfill({ json: { acknowledged: true } }));
  await regular.goto("/app");
  await regular.getByLabel("用户名", { exact: true }).fill(username);
  await regular.getByLabel("密码", { exact: true }).fill("Quarantine-test-123");
  await regular.getByRole("button", { name: "登录", exact: true }).click();
  await openNavigationEntry(regular, "检疫管理", "检疫报告");
  await expect(regular.getByRole("button", { name: "新建检疫批次", exact: true })).toBeVisible();
  const saved = await regular.request.post("/api/quarantine/batches", {
    data: {
      item: {
        id: randomUUID(),
        name: "普通账号检疫",
        sources: [{ id: "source", supplier: "哨兵鼠供应商", species: "大鼠" }],
      },
    },
  });
  expect(saved.ok()).toBe(true);
  await context.close();
});

test("received animals flow through pool, covered cohort and manual completion", async ({ page }, testInfo) => {
  await login(page);
  await ensureTestInfrastructure(page);
  const suffix = randomUUID();
  const intakeIds = [`intake-a-${suffix}`, `intake-b-${suffix}`];
  for (const intakeId of intakeIds) {
    const created = await page.request.post("/api/intake-batches", {
      data: {
        item: {
          id: intakeId,
          batchNo: intakeId,
          receiverName: "系统管理员",
          status: "pending_print",
          iacuc: "Z2026001",
          supplier: "广东药康",
          pi: "检疫测试课题组",
          owner: "检测员",
          roomName: "8014",
          intakeDate: "2026-09-09",
          quantity: 5,
          finalCardCount: 1,
          suggestedCardCount: 1,
          species: "mouse",
          strainStandard: "C57BL/6J",
          cards: [],
        },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
  }
  let pool = await (await page.request.get("/api/quarantine/sources?limit=200")).json();
  expect(pool.items.some((i: { id: string }) => intakeIds.includes(i.id))).toBe(false);
  expect((await page.request.post("/api/intake-batches/mark-printed", { data: { ids: intakeIds } })).ok()).toBe(true);
  for (const intakeId of intakeIds) {
    const received = await page.request.post(`/api/intake-batches/${intakeId}/confirm-receipt`, {
      data: { actualReceiptDate: "2026-09-09", cardCount: 1 },
    });
    expect(received.ok(), await received.text()).toBe(true);
  }
  await openNavigationEntry(page, "检疫管理", "检疫报告");
  for (const intakeId of intakeIds) {
    const row = page.getByRole("row").filter({ hasText: intakeId });
    await expect(row).toContainText("C57BL/6J");
    await expect(row).toContainText("待检疫");
    await row.getByRole("checkbox").check();
  }
  await page.getByRole("button", { name: "用所选动物新建检疫批次（2）" }).click();
  await page.getByRole("textbox", { name: "检疫批次名称", exact: true }).fill(`整批检疫-${suffix}`);
  await page.getByRole("textbox", { name: "检疫最终结论" }).fill("所属检疫批次抽检无异常");
  await page.getByRole("button", { name: "保存检疫批次", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "确认检疫完成", exact: true })).toBeDisabled();
  const batches = await (await page.request.get(`/api/quarantine/batches?search=${encodeURIComponent(suffix)}`)).json();
  const batch = batches.items[0];
  pool = await (await page.request.get("/api/quarantine/sources?limit=200")).json();
  expect(pool.items.some((i: { id: string }) => intakeIds.includes(i.id))).toBe(false);
  for (const method of ["parasite", "elisa_mouse", "pcr"]) {
    const saved = await page.request.post("/api/quarantine/tests", {
      data: {
        item: {
          id: randomUUID(),
          batchId: batch.id,
          method,
          samplingDate: "2026-09-09",
          testDate: "2026-09-09",
          conclusion: "抽检无异常",
          samples: [
            {
              id: "s",
              number: "1",
              material: "检测材料",
              poolCount: 1,
              portionCount: 2,
              sourceIds: [batch.sources[0].id],
            },
          ],
          projects: [
            {
              id: "p",
              name: "检测项目",
              kit: "试剂盒",
              lot: "lot",
              nc: "negative",
              pc: "positive",
              sampleIds: ["s"],
              results: { s: "negative" },
              wells: {},
            },
          ],
        },
      },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    const t = (await saved.json()).item;
    const issued = await page.request.post(`/api/quarantine/tests/${t.id}/issue`, {
      data: { expectedUpdatedAt: t.updatedAt, expectedBatchUpdatedAt: batch.updatedAt },
    });
    expect(issued.ok(), await issued.text()).toBe(true);
  }
  await page.reload();
  await openNavigationEntry(page, "检疫管理", "检疫报告");
  await page.getByRole("tab", { name: "批次与报告", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: `整批检疫-${suffix}` })
    .getByRole("button", { name: "查看检疫批次" })
    .click();
  await page.getByRole("button", { name: "确认检疫完成", exact: true }).click();
  await page.getByRole("button", { name: "确认整批已检疫", exact: true }).click();
  await expect(page.getByText("整批已检疫 · 确认人：系统管理员")).toBeVisible();
  const detail = await (await page.request.get(`/api/quarantine/batches/${batch.id}`)).json();
  expect(detail.item.completionReportIds).toHaveLength(3);
  expect(detail.tests.every((t: { samples: unknown[] }) => t.samples.length === 1)).toBe(true);
  const receivedList = await (await page.request.get("/api/intake-batches?limit=200")).json();
  for (const intakeId of intakeIds) {
    const animal = receivedList.items.find((i: { id: string }) => i.id === intakeId);
    expect(animal.status).toBe("received");
    expect(animal.quarantineStatus).toBe("已检疫");
  }
  expect(JSON.stringify(await (await page.request.get("/api/audit-events?limit=100")).json())).toContain(
    "quarantine.batch_completed",
  );
  await openNavigationEntry(page, "笼卡管理", "待接收批次");
  const intakeRow = page.getByRole("row").filter({ hasText: intakeIds[1] });
  await intakeRow.getByRole("button", { name: "检疫记录" }).click();
  await expect(page.getByRole("dialog")).toContainText("所属检疫批次抽检无异常");
  await expect(page.getByRole("dialog").getByRole("button", { name: /v1/ })).toHaveCount(3);
  await expect(page.getByRole("dialog").getByRole("button", { name: /v1/ }).first()).toBeVisible();
  for (const width of [1440, 1180, 760, 844, 390]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
    const metrics = await page.getByRole("dialog").evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      overflow: el.scrollWidth > el.clientWidth,
      gap: getComputedStyle(el.querySelector('[data-feature="quarantine"]')!).gap,
    }));
    expect(metrics.overflow).toBe(false);
    expect(metrics.width).toBeLessThanOrEqual(width);
    await testInfo.attach(`reports-style-${width}`, { body: JSON.stringify(metrics), contentType: "application/json" });
    await page.screenshot({
      path: testInfo.outputPath(`completed-reports-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
});

test("ELISA report form links sources, symbols and multi-project image metadata", async ({ page }, testInfo) => {
  await login(page);
  const batchId = randomUUID();
  const batchName = `ELISA填写-${batchId}`;
  const batchResponse = await page.request.post("/api/quarantine/batches", {
    data: {
      item: {
        id: batchId,
        name: batchName,
        sources: [
          { id: "a", supplier: "江苏集萃", species: "小鼠", pi: "甲组", owner: "张同学" },
          { id: "b", supplier: "江苏集萃", species: "小鼠", pi: "乙组", owner: "李同学" },
        ],
      },
    },
  });
  expect(batchResponse.ok()).toBe(true);
  const recordId = randomUUID();
  const recordResponse = await page.request.post("/api/quarantine/tests", {
    data: {
      item: {
        id: recordId,
        batchId,
        method: "elisa_mouse",
        reportFormVersion: 2,
        reportMaterial: "血清",
        reportSpecimenState: "液体",
        samplingDate: "2026-09-02",
        testDate: "2026-09-03",
        samples: [
          {
            id: "s",
            number: "1",
            material: "血清",
            specimenState: "液体",
            sourceIds: ["a"],
            poolCount: 1,
            portionCount: 1,
          },
        ],
        projects: ["MHV", "SV"].map((name) => ({
          id: name,
          name,
          kit: `${name}试剂盒`,
          lot: "LOT1",
          sampleIds: ["s"],
          results: { s: "negative" },
          nc: "negative",
          pc: "positive",
          wells: {},
        })),
      },
    },
  });
  expect(recordResponse.ok()).toBe(true);
  await openNavigationEntry(page, "检疫管理", "ELISA检测");
  await page.getByRole("row").filter({ hasText: batchName }).getByRole("button", { name: "查看检测记录" }).click();
  await page.getByRole("button", { name: "ELISA检测（小鼠） · 2026-09-03 · 草稿", exact: true }).click();
  await page.getByRole("button", { name: "编辑检测", exact: true }).click();
  const source = page.getByRole("combobox", { name: "混样来源 1", exact: true });
  await source.click();
  const dropdown = page.locator(".ant-select-dropdown").filter({ visible: true });
  await expect(dropdown).not.toContainText("江苏集萃");
  await dropdown.getByText("乙组／李同学", { exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("1样（2份血清）", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "结果判定", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "MHV 1 判定", exact: true }).click();
  await expect(
    page.locator(".ant-select-dropdown").filter({ visible: true }).locator(".ant-select-item-option-content"),
  ).toHaveText(["/", "-", "＋", "±"]);
  await page.keyboard.press("Escape");
  const projects = page.getByRole("combobox", { name: "附件检测项目", exact: true });
  await projects.click();
  await page
    .locator(".ant-select-dropdown")
    .filter({ visible: true })
    .locator(".ant-select-item-option-content")
    .filter({ hasText: /^MHV$/ })
    .click();
  await page
    .locator(".ant-select-dropdown")
    .filter({ visible: true })
    .locator(".ant-select-item-option-content")
    .filter({ hasText: /^SV$/ })
    .click();
  await page.keyboard.press("Escape");
  await page.locator('input[type="file"]').setInputFiles({
    name: "gel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByRole("textbox", { name: "gel.png 图注" })).toBeVisible();
  await page.getByRole("textbox", { name: "gel.png 图注" }).fill("MHV和SV原始读数");
  await page.getByRole("button", { name: "保存图片信息" }).click();
  await expect
    .poll(async () => {
      const detail = await (await page.request.get(`/api/quarantine/batches/${batchId}`)).json();
      return detail.attachments[0]?.caption;
    })
    .toBe("MHV和SV原始读数");
  const detail = await (await page.request.get(`/api/quarantine/batches/${batchId}`)).json();
  expect(detail.attachments[0].projectIds).toEqual(["MHV", "SV"]);
  expect(detail.tests[0].samples[0].portionCount).toBe(2);
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "MHV和SV原始读数", exact: true })
        .evaluate((el) => (el as HTMLImageElement).naturalWidth),
    )
    .toBe(1);
  await page.screenshot({ path: testInfo.outputPath("elisa-record.png"), fullPage: true });
  await page.getByRole("button", { name: "保存检测草稿" }).click();
  await page.getByRole("button", { name: "返回批次" }).click();
  await page.getByRole("button", { name: "出具报告", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认出具" }).click();
  await expect(page.getByRole("button", { name: "创建更正草稿" })).toBeVisible();
});
