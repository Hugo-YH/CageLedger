import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { expect, openNavigationEntry, test } from "./fixtures";

const LIST_MONTH = "2098-08";
const savedSheetIds: string[] = [];
test.use({ actionTimeout: 10_000 });

test.afterEach(async ({ page }) => {
  for (const id of savedSheetIds.splice(0)) {
    const response = await page.request.get(`/api/technical-services/sheets/${id}`);
    if (response.status() === 404) continue;
    expect(response.ok(), await response.text()).toBeTruthy();
    const { item } = (await response.json()) as { item: { updatedAt: string } };
    const deleted = await page.request.delete(`/api/technical-services/sheets/${id}`, {
      data: { expectedUpdatedAt: item.updatedAt },
    });
    expect(deleted.ok(), await deleted.text()).toBeTruthy();
  }
});

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
}

async function applyServiceFilter(page: Page, column: string, value: string) {
  await page.getByRole("button", { name: `筛选${column}`, exact: true }).click();
  const options = page.getByRole("group", { name: `筛选${column}选项`, exact: true });
  await expect(options).toBeVisible();
  await options.getByRole("button", { name: "清空", exact: true }).click();
  const choice = options.getByRole("checkbox", { name: value, exact: false });
  await choice.click();
  await expect(choice).toBeChecked();
  await options.getByRole("button", { name: "应用", exact: true }).click();
  await expect(options).toBeHidden();
}

async function seedSavedServiceList(page: Page) {
  const rows = Array.from({ length: 32 }, (_, index) => {
    const number = String(index + 1).padStart(3, "0");
    return {
      iacuc: `Z2098${number}`,
      pi: `UX 列表负责人 ${number}`,
      id: `ux-list-${number}-${Date.now()}`,
    };
  });
  const csv = [
    "动物伦理编号,动物实验名称,项目负责人,实验负责人,项目来源",
    ...rows.map(({ iacuc, pi }) => `${iacuc},桌面列表状态恢复回归项目,${pi},UX 实验负责人,UX 经费`),
    "",
  ].join("\n");
  const upload = await page.request.post("/api/iacuc-index/upload", {
    multipart: { file: { name: "desktop-fee-ux.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();

  for (const row of rows) {
    const saved = await page.request.post("/api/technical-services/sheets", {
      data: {
        sheet: {
          id: row.id,
          month: LIST_MONTH,
          iacuc: row.iacuc,
          facility: "zhujiang",
          customerType: "internal",
          serviceId: "large_eye_drops",
          rows: [{ date: `${LIST_MONTH}-01`, quantity: 1 }],
        },
      },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    savedSheetIds.push(((await saved.json()) as { item: { id: string } }).item.id);
  }
}

test("monthly summary retry keeps its month and reports only the current export result", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const upload = await page.request.post("/api/iacuc-index/upload", {
    multipart: {
      file: {
        name: "ux-export.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          "动物伦理编号,动物实验名称,项目负责人,实验负责人,项目来源\nZ2097555,导出反馈测试项目,UX导出负责人,UX实验负责人,UX经费\n",
        ),
      },
    },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const saved = await page.request.post("/api/technical-services/sheets", {
    data: {
      sheet: {
        id: `ux-export-sample-${Date.now()}`,
        month: LIST_MONTH,
        iacuc: "Z2097555",
        facility: "bioisland",
        customerType: "internal",
        serviceId: "large_eye_drops",
        rows: [{ date: `${LIST_MONTH}-01`, quantity: 1 }],
      },
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  savedSheetIds.push(((await saved.json()) as { item: { id: string } }).item.id);
  await openNavigationEntry(page, "结算管理", "汇总导出");
  const summary = page.getByRole("region", { name: "月度汇总导出工作区", exact: true });
  const month = page.getByRole("textbox", { name: "结算月份", exact: true });
  await month.fill(LIST_MONTH);
  await month.press("Enter");

  let attempts = 0;
  await page.route("**/api/billing-monthly-summary/export", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "汇总导出暂不可用" }),
      });
      return;
    }
    await route.continue();
  });

  await summary.getByRole("button", { name: "导出月度汇总 Excel", exact: true }).click();
  const failure = summary.getByRole("alert").filter({ hasText: "汇总导出暂不可用" });
  await expect(failure).toHaveClass(/ant-alert-error/);
  await expect(summary.getByText("汇总导出暂不可用", { exact: true })).toHaveCount(1);
  await expect(summary.getByRole("status")).toHaveCount(0);

  const download = page.waitForEvent("download");
  await summary.getByRole("button", { name: "重试导出", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
  await expect(month).toHaveValue(LIST_MONTH);
  await expect(summary.getByRole("status")).toContainText("已开始下载");
  expect(attempts).toBe(2);
});

test("saved technical service list restores desktop filters, density, pagination, sorting and workspace scroll", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 600 });
  await login(page);
  await seedSavedServiceList(page);
  let lastServiceQuery = new URLSearchParams();
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().includes("/api/technical-services/sheets?"))
      lastServiceQuery = new URL(request.url()).searchParams;
  });
  await openNavigationEntry(page, "技术服务费管理", "已保存技术服务明细");
  const list = page.getByRole("region", { name: "已保存技术服务明细列表", exact: true });
  await expect(list.getByRole("row").filter({ hasText: "Z2098001" })).toBeVisible();

  await applyServiceFilter(page, "月份", LIST_MONTH);
  await applyServiceFilter(page, "服务设施", "珠江新城");
  await expect(list.getByLabel("已应用筛选")).toContainText(`月份：${LIST_MONTH}`);
  await expect(list.getByLabel("已应用筛选")).toContainText("服务设施：珠江新城");
  await list.getByText("紧凑", { exact: true }).click();
  await expect(list.getByRole("radio", { name: "紧凑", exact: true })).toBeChecked();
  await list.getByRole("button", { name: "项目负责人，点击切换排序", exact: true }).click();
  await expect.poll(() => lastServiceQuery.get("sortKey")).toBe("pi");
  await expect.poll(() => lastServiceQuery.get("sortDir")).toBe("asc");
  await page.locator(".ant-pagination-next").click();
  await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
  await expect(list).toHaveAttribute("aria-busy", "false");
  await expect(list.getByRole("row").filter({ hasText: "Z2098011" })).toBeVisible();

  const savedScrollTop = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>("[data-ui=workspace]");
    const target =
      workspace && /(auto|scroll)/.test(getComputedStyle(workspace).overflowY) ? workspace : document.scrollingElement!;
    target.scrollTop = Math.min(180, target.scrollHeight - target.clientHeight);
    return target.scrollTop;
  });
  expect(savedScrollTop).toBeGreaterThan(0);
  await openNavigationEntry(page, "结算管理", "汇总导出");
  await expect(page.getByRole("region", { name: "月度汇总导出工作区", exact: true })).toBeVisible();
  await openNavigationEntry(page, "技术服务费管理", "已保存技术服务明细");

  await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
  await expect(list.getByRole("radio", { name: "紧凑", exact: true })).toBeChecked();
  await expect(list.getByLabel("已应用筛选")).toContainText(`月份：${LIST_MONTH}`);
  await expect(list.getByLabel("已应用筛选")).toContainText("服务设施：珠江新城");
  expect(lastServiceQuery.get("sortKey")).toBe("pi");
  expect(lastServiceQuery.get("sortDir")).toBe("asc");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const workspace = document.querySelector<HTMLElement>("[data-ui=workspace]");
        const target =
          workspace && /(auto|scroll)/.test(getComputedStyle(workspace).overflowY)
            ? workspace
            : document.scrollingElement!;
        return target.scrollTop;
      }),
    )
    .toBe(savedScrollTop);

  const applied = list.getByLabel("已应用筛选");
  await applied
    .locator(".ant-tag")
    .filter({ hasText: `月份：${LIST_MONTH}` })
    .locator(".ant-tag-close-icon")
    .click();
  await expect(applied).not.toContainText(`月份：${LIST_MONTH}`);
  await expect(applied).toContainText("服务设施：珠江新城");
  await applied.getByRole("button", { name: "清除全部筛选", exact: true }).click();
  await expect(applied).toContainText("全部结果");
});

test("service review shows expandable project information and preserves totals across desktop layouts", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await login(page);
  const projectName = "技术服务录入桌面核对及长项目名称验证".repeat(24);
  const csv = `动物伦理编号,动物实验名称,项目负责人,实验负责人,项目来源\nZ2099555,${projectName},UX核对负责人,UX实验负责人,UX核对经费\n`;
  const uploaded = await page.request.post("/api/iacuc-index/upload", {
    multipart: { file: { name: "ux-long-project.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  await openNavigationEntry(page, "技术服务费管理", "录入技术服务明细");
  await page.locator("#service-iacuc").fill("Z2099555");
  await page.locator("#service-iacuc").blur();
  const info = page.getByRole("region", { name: "IACUC项目信息", exact: true });
  await expect(info).toContainText("UX核对负责人");
  await expect(info.locator("input")).toHaveCount(0);
  await info.getByText("展开", { exact: true }).click();
  await expect(info).toContainText(projectName);
  await page.evaluate(() => {
    const capture = (text: string) => {
      (window as Window & { copiedProject?: string }).copiedProject = text;
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (text: string) => Promise.resolve(capture(text)) },
    });
    document.execCommand = (command: string) => {
      if (command !== "copy") return false;
      capture(window.getSelection()?.toString() || "");
      return true;
    };
  });
  await info.locator(".technical-service-project-text .ant-typography-copy").click();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { copiedProject?: string }).copiedProject))
    .toBe(projectName);
  await info.getByText("收起", { exact: true }).click();
  await page.locator("#service-item").click();
  await page.locator("#service-item").fill("大动物滴眼");
  await page.getByText("大动物滴眼", { exact: true }).click();
  for (const [index, [day, quantity]] of [
    [1, 2],
    [2, 2],
    [3, 4],
    [10, 2],
  ].entries()) {
    if (index) await page.getByRole("button", { name: "添加服务日期", exact: true }).click();
    await page.getByLabel(`服务日期 ${index + 1}`, { exact: true }).fill(`2026-10-${String(day).padStart(2, "0")}`);
    await page.getByLabel(`服务日期 ${index + 1}`, { exact: true }).press("Enter");
    await page.getByLabel(`计费数量 ${index + 1}`, { exact: true }).fill(String(quantity));
  }
  const totals = page.getByRole("region", { name: "技术服务费用核对", exact: true });
  await expect(totals).toContainText("4个服务日");
  await expect(totals).toContainText("10眼");
  await expect(totals).toContainText("300.00元");
  await totals.click();
  await expect(page.locator(".ant-picker-dropdown:visible")).toHaveCount(0);
  for (const [width, height] of [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator("[data-ui=workspace]").evaluate((element) => {
      element.scrollTop = 0;
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    await testInfo.attach(`ux-review-${width}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await testInfo.attach(`ux-review-computed-${width}`, {
      body: Buffer.from(
        JSON.stringify(
          await page.locator(".technical-service-form-panel").evaluate((element) => {
            const summary = element.querySelector<HTMLElement>(".technical-service-totals")!;
            const project = element.querySelector<HTMLElement>(".technical-service-project-info")!;
            const field = element.querySelector<HTMLInputElement>("#service-iacuc")!;
            return {
              panel: { width: element.getBoundingClientRect().width, display: getComputedStyle(element).display },
              summary: {
                width: summary.getBoundingClientRect().width,
                columns: getComputedStyle(summary).gridTemplateColumns,
                gap: getComputedStyle(summary).gap,
                borderRadius: getComputedStyle(summary).borderRadius,
              },
              project: { width: project.getBoundingClientRect().width, minWidth: getComputedStyle(project).minWidth },
              input: { height: field.getBoundingClientRect().height, fontSize: getComputedStyle(field).fontSize },
            };
          }),
        ),
      ),
      contentType: "application/json",
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const accessibility = await new AxeBuilder({ page }).include(".technical-service-layout").analyze();
  expect(accessibility.violations.filter((v) => ["serious", "critical"].includes(v.impact || ""))).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.getByLabel("计费数量 3", { exact: true })).toHaveValue("4");
  await expect(page.locator("#service-iacuc")).toHaveValue("Z2099555");
  await expect(totals).toContainText("300.00元");
  await testInfo.attach("ux-review-dark-reduced-motion", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await expect(page.getByLabel("计费数量 3", { exact: true })).toHaveValue("4");
});
