import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
}

async function openFeedback(page: Page) {
  if (await page.evaluate(() => window.matchMedia("(max-width: 767px)").matches)) {
    await page.getByRole("tab", { name: "更多", exact: true }).click();
    await page.locator(".ant-mobile-navigation-sheet .adm-list-item").filter({ hasText: "帮助与反馈" }).click();
  } else {
    await page.getByRole("menuitem", { name: /帮助与反馈/ }).click();
  }
  await expect(page.getByRole("heading", { name: "帮助与反馈", exact: true })).toBeVisible();
}

async function filterColumn(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: `筛选${label}`, exact: true }).click();
  const panel = page.getByRole("group", { name: `筛选${label}选项`, exact: true });
  await panel.getByPlaceholder("搜索当前列").fill(option);
  await panel.getByRole("checkbox", { name: option }).click();
  await expect(panel.getByRole("checkbox", { name: option })).toBeChecked();
  await panel.getByRole("button", { name: /应\s*用/ }).click();
  await expect(panel).toBeHidden();
}

test("feedback saves two distinct originals, appends and keeps encounters idempotent", async ({ page }) => {
  await login(page);
  await openFeedback(page);
  const title = `反馈流程 ${Date.now()}`;
  for (const suffix of ["甲", "乙"]) {
    await page.getByRole("button", { name: "提交反馈", exact: true }).click();
    const drawer = page.getByRole("dialog");
    await drawer.getByLabel("标题", { exact: true }).fill(title + suffix);
    await drawer.getByLabel("涉及模块", { exact: true }).fill("笼卡管理");
    await drawer.getByLabel("问题描述", { exact: true }).fill("<img src=x onerror=alert(1)> 原始反馈\n保留换行");
    await drawer.getByRole("button", { name: "提交", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(title + suffix);
    await expect(page.getByRole("dialog")).toContainText("原始反馈");
    await expect(page.getByRole("dialog").locator("img")).toHaveCount(0);
    await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  }
  await page
    .getByRole("button", { name: /查看反馈/ })
    .filter({ hasText: title + "甲" })
    .click();
  const detail = page.getByRole("dialog");
  await detail.getByLabel("追加说明内容", { exact: true }).fill("所有同事可以继续补充");
  await detail.getByRole("button", { name: "追加说明", exact: true }).click();
  await expect(detail.getByText("所有同事可以继续补充", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "我也遇到", exact: true }).click();
  await expect(detail.getByRole("button", { name: /取消遇到.*1/ })).toBeVisible();
  await detail.getByRole("button", { name: /取消遇到/ }).click();
  await expect(detail.getByRole("button", { name: "我也遇到", exact: true })).toBeVisible();
  const response = await page.request.get(`/api/feedback?keyword=${encodeURIComponent(title)}`);
  const payload = await response.json();
  expect(payload.total).toBe(2);
  expect(new Set(payload.items.map((item: { id: string }) => item.id)).size).toBe(2);
  expect(payload.items.find((item: { title: string }) => item.title === title + "甲").encounterCount).toBe(0);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 760, height: 900 },
]) {
  test(`feedback Markdown original and replies ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await login(page);
    const title = `Markdown 反馈 ${Date.now()}`;
    const description = [
      "## 反馈信息",
      "",
      "- 提出人：张三",
      "- **功能建议**",
      "",
      "> 保留原始记录",
      "",
      "| 一 | 二 | 三 | 四 | 五 | 六 | 七 | 八 | 九 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |",
      "",
      "```text",
      "x".repeat(300),
      "```",
      "",
      "<img src=x onerror=alert(1)>",
      "",
      "![截图](https://example.com/private.png)",
    ].join("\n");
    const externalImages: string[] = [];
    page.on("request", (request) => {
      if (request.url() === "https://example.com/private.png") externalImages.push(request.url());
    });
    const created = await page.request.post("/api/feedback", {
      data: { requestId: crypto.randomUUID(), title, kind: "suggestion", module: "反馈", description, environment: {} },
    });
    expect(created.ok()).toBeTruthy();
    const item = (await created.json()).item;
    await openFeedback(page);
    await page
      .getByRole("button", { name: /查看反馈/ })
      .filter({ hasText: title })
      .click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "反馈信息", exact: true })).toBeVisible();
    await expect(drawer.locator("ul li")).toHaveCount(2);
    await expect(drawer.locator("blockquote")).toHaveText("保留原始记录");
    await expect(drawer.locator("img")).toHaveCount(0);
    const styles = await drawer.locator(".feedback-markdown").evaluate((element) => {
      const style = getComputedStyle(element);
      const table = element.querySelector(".feedback-markdown-table")!;
      const code = element.querySelector("pre")!;
      const body = element.closest(".ant-drawer-body")!;
      return {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        tableScrolls: table.scrollWidth > table.clientWidth,
        codeScrolls: code.scrollWidth > code.clientWidth,
        bodyOverflow: body.scrollWidth > body.clientWidth + 1,
      };
    });
    expect(styles).toMatchObject({
      fontSize: "14px",
      tableScrolls: true,
      codeScrolls: true,
      bodyOverflow: false,
    });
    expect(Number.parseFloat(styles.lineHeight)).toBeCloseTo(22, 2);
    for (const name of ["反馈表格", "代码块"]) {
      const region = drawer.getByRole("region", { name, exact: true });
      await region.focus();
      await region.press("ArrowRight");
      await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    }
    await drawer.getByLabel("追加说明内容").fill("### 复验结果\n\n1. **保存成功**\n2. `检查通过`");
    await drawer.getByRole("button", { name: "追加说明", exact: true }).click();
    await expect(drawer.getByRole("heading", { name: "复验结果", exact: true })).toBeVisible();
    await expect(drawer.locator(".feedback-comment ol li")).toHaveCount(2);
    const stored = await page.request.get(`/api/feedback/${item.id}`);
    expect((await stored.json()).item.description).toBe(description);
    expect(externalImages).toEqual([]);
    await testInfo.attach("markdown-styles", {
      body: JSON.stringify(styles, null, 2),
      contentType: "application/json",
    });
    await drawer.getByRole("heading", { name: "反馈信息", exact: true }).scrollIntoViewIfNeeded();
    await testInfo.attach("markdown-layout", { body: await page.screenshot(), contentType: "image/png" });
  });
}

test("regular colleagues can read and supplement but cannot retry integrations", async ({ page }) => {
  await login(page);
  const unique = Date.now();
  const created = await page.request.post("/api/feedback", {
    data: {
      requestId: crypto.randomUUID(),
      title: `全员反馈 ${unique}`,
      kind: "question",
      module: "反馈",
      description: "管理员的原始记录",
      environment: {},
    },
  });
  expect(created.ok()).toBeTruthy();
  const item = (await created.json()).item;
  const username = `feedback_colleague_${unique}`;
  const account = await page.request.post("/api/users", {
    data: { username, displayName: "反馈同事", password: "feedback-password", role: "room_admin", roomIds: [] },
  });
  expect(account.ok()).toBeTruthy();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill("feedback-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await openFeedback(page);
  await expect(page.getByRole("button", { name: "导入历史工单", exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: /查看反馈/ })
    .filter({ hasText: item.title })
    .click();
  await expect(page.getByRole("dialog")).toContainText("管理员的原始记录");
  await expect(page.getByRole("heading", { name: "管理员操作" })).toHaveCount(0);
  const denied = await page.request.post(`/api/feedback/${item.id}/retry`, { data: {} });
  expect(denied.status()).toBe(403);
  const deniedIntegration = await page.request.get("/api/feedback/integration");
  expect(deniedIntegration.status()).toBe(403);
});

function importCandidate(number: number, importable = true) {
  return {
    number,
    title: `历史需求 ${number} ${"长标题".repeat(6)}`,
    kind: "suggestion",
    module: "笼位管理",
    reporter: "张三",
    reporterSource: "record",
    state: "closed",
    status: "resolved",
    createdAt: "2025-01-01T00:00:00Z",
    importable,
    reason: importable ? "" : "已关联到系统反馈",
  };
}

test("historical import preserves cross-page selection, retries only failures and clears applied scope", async ({
  page,
}) => {
  const requests: Array<{ requestId: string; numbers: number[] }> = [];
  let imported = false;
  await page.route("**/api/feedback/import/preview?**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const secondPage = query.get("page") === "2";
    await route.fulfill({
      json: {
        repository: "https://mock.test/hugo/cageledger",
        page: secondPage ? 2 : 1,
        hasMore: !secondPage,
        items: secondPage ? [importCandidate(21)] : [importCandidate(1, !imported), importCandidate(2, false)],
      },
    });
  });
  await page.route("**/api/feedback/import", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    imported = true;
    await route.fulfill({
      json: {
        items:
          requests.length === 1
            ? [
                { number: 1, outcome: "imported", message: "已导入原工单" },
                { number: 21, outcome: "failed", message: "临时故障" },
              ]
            : [{ number: 21, outcome: "imported", message: "已导入原工单" }],
      },
    });
  });
  await login(page);
  await openFeedback(page);
  await page.getByRole("button", { name: "导入历史工单", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "导入 Gitea 历史工单", exact: true });
  await expect(drawer.getByRole("checkbox", { name: "选择工单 #2", exact: true })).toBeDisabled();
  await drawer.getByRole("checkbox", { name: "选择工单 #1", exact: true }).click();
  await expect(drawer.getByRole("checkbox", { name: "选择工单 #1", exact: true })).toBeChecked();
  await drawer.getByRole("button", { name: "下一页", exact: true }).click();
  await drawer.getByRole("checkbox", { name: "选择工单 #21", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "导入所选（2）", exact: true })).toBeEnabled();
  await drawer.getByRole("button", { name: "导入所选（2）", exact: true }).click();
  await expect(drawer.getByLabel("导入结果")).toContainText("失败 1 条");
  await drawer.getByRole("button", { name: "导入所选（1）", exact: true }).click();
  await expect(drawer.getByLabel("导入结果")).toContainText("失败 0 条");
  expect(requests[0].numbers).toEqual([1, 21]);
  expect(requests[1].numbers).toEqual([21]);
  expect(requests[0].requestId).not.toBe(requests[1].requestId);
  await drawer.getByRole("checkbox", { name: "选择工单 #21", exact: true }).click();
  await drawer.getByRole("combobox", { name: "工单范围", exact: true }).click();
  await page.locator(".ant-select-dropdown").getByText("已关闭", { exact: true }).click();
  await expect(drawer.getByRole("button", { name: "导入所选（0）", exact: true })).toBeDisabled();
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1180, height: 800 },
  { width: 760, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`historical import layout ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: viewport.width === 1180 ? "dark" : "light", reducedMotion: "reduce" });
    await page.route("**/api/feedback/import/preview?**", (route) =>
      route.fulfill({
        json: { repository: "https://mock.test/hugo/cageledger", page: 1, hasMore: false, items: [importCandidate(1)] },
      }),
    );
    await login(page);
    await openFeedback(page);
    await page.getByRole("button", { name: "导入历史工单", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "导入 Gitea 历史工单", exact: true });
    await expect(drawer.getByRole("checkbox", { name: "选择工单 #1", exact: true })).toBeVisible();
    const styles = await drawer.evaluate((node) => {
      const close = node.querySelector<HTMLButtonElement>('button[aria-label="关闭导入窗口"]')!;
      const rect = close.getBoundingClientRect();
      return {
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
        footerVisible: rect.bottom <= window.innerHeight && rect.top >= 0,
        button: { height: rect.height, fontSize: getComputedStyle(close).fontSize },
        tableLocalScroll: node.querySelector(".ant-table-content")?.scrollWidth,
      };
    });
    expect(styles.pageOverflow).toBe(false);
    expect(styles.footerVisible).toBe(true);
    expect(styles.button.height).toBeGreaterThanOrEqual(32);
    await testInfo.attach("import-styles", { body: JSON.stringify(styles, null, 2), contentType: "application/json" });
    await page.screenshot({ path: testInfo.outputPath("feedback-import.png"), fullPage: true });
    await drawer.getByRole("button", { name: "关闭导入窗口", exact: true }).click();
    await expect(drawer).toBeHidden();
  });
}

test("header funnels apply only on confirmation, clear and query beyond the current page", async ({
  page,
}, testInfo) => {
  await login(page);
  const module = `筛选模块 ${Date.now()}`;
  const ids: string[] = [];
  for (const suffix of ["甲", "乙"]) {
    const response = await page.request.post("/api/feedback", {
      data: {
        requestId: crypto.randomUUID(),
        title: module + suffix,
        kind: suffix === "甲" ? "bug" : "question",
        module,
        description: "表头筛选回归",
        environment: {},
      },
    });
    expect(response.ok()).toBeTruthy();
    ids.push((await response.json()).item.id);
  }
  await openFeedback(page);
  await expect(page.getByLabel("搜索反馈")).toHaveCount(0);
  await page.getByRole("button", { name: "筛选模块", exact: true }).click();
  const panel = page.getByRole("group", { name: "筛选模块选项", exact: true });
  await panel.getByPlaceholder("搜索当前列").fill(module);
  await panel.getByRole("checkbox", { name: module }).click();
  await expect(panel.getByRole("checkbox", { name: module })).toBeChecked();
  await expect(page.getByRole("button", { name: "清空筛选", exact: true })).toHaveCount(0);
  await expect(panel.locator("small")).toHaveText("2");
  await panel.getByRole("button", { name: /应\s*用/ }).click();
  await expect(page.getByText("共 2 条反馈", { exact: true })).toBeVisible();
  await filterColumn(page, "类型", "使用疑问");
  await expect(page.getByText("共 1 条反馈", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /查看反馈/ }).filter({ hasText: module + "乙" })).toBeVisible();
  await page.getByRole("button", { name: "筛选类型", exact: true }).click();
  const kinds = page.getByRole("group", { name: "筛选类型选项", exact: true });
  await expect(kinds.getByRole("checkbox", { name: "故障" })).toBeVisible();
  await kinds.getByRole("button", { name: /清\s*空/ }).click();
  await kinds.getByRole("button", { name: /应\s*用/ }).click();
  await expect(page.getByText("共 2 条反馈", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "编号，点击切换排序", exact: true }).click();
  const request = await page.request.get(
    `/api/feedback?${new URLSearchParams({ columnFilters: JSON.stringify({ module: [module] }), limit: "1", offset: "1", sortKey: "number", sortDir: "asc" })}`,
  );
  expect((await request.json()).items[0].id).toBe(ids[1]);
  await page.screenshot({ path: testInfo.outputPath("feedback-header-filters.png"), fullPage: true });
  await page.getByRole("button", { name: "清空筛选", exact: true }).click();
  await expect(page.getByRole("button", { name: "清空筛选", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "筛选模块", exact: true })).toHaveAttribute("aria-pressed", "false");
  let unavailable = true;
  await page.route("**/api/feedback/filter-options?*", async (route) => {
    if (unavailable && new URL(route.request().url()).searchParams.get("column") === "module") {
      await route.fulfill({ status: 503, json: { error: "筛选服务暂时不可用" } });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "筛选模块", exact: true }).click();
  const failed = page.getByRole("group", { name: "筛选模块选项", exact: true });
  await expect(failed.getByText("筛选选项加载失败", { exact: true })).toBeVisible();
  await expect(failed.getByText("当前列没有可选项。", { exact: true })).toHaveCount(0);
  unavailable = false;
  await failed.getByRole("button", { name: /重\s*试/ }).click();
  await expect(failed.getByRole("checkbox", { name: module })).toBeVisible();
  await failed.getByRole("button", { name: /应\s*用/ }).click();
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1180, height: 800 },
  { width: 760, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`feedback layout ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: viewport.width === 1180 ? "dark" : "light" });
    await login(page);
    await openFeedback(page);
    await expect(page.getByRole("button", { name: "提交反馈", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath("feedback-list.png"), fullPage: true });
    await page.getByRole("button", { name: "提交反馈", exact: true }).click();
    await expect(page.getByRole("dialog").getByLabel("标题", { exact: true })).toBeVisible();
    await page.getByRole("dialog").getByLabel("标题", { exact: true }).fill("长标题内容测试".repeat(15));
    await page.getByRole("dialog").getByLabel("涉及模块", { exact: true }).focus();
    await expect(page.getByRole("dialog").getByLabel("涉及模块", { exact: true })).toBeFocused();
    const styles = await page
      .getByRole("dialog")
      .getByLabel("标题", { exact: true })
      .evaluate((input) => {
        const style = getComputedStyle(input);
        return {
          height: input.getBoundingClientRect().height,
          font: style.fontSize,
          color: style.color,
          lineHeight: style.lineHeight,
        };
      });
    expect(styles.height).toBeGreaterThanOrEqual(32);
    await testInfo.attach("input-styles", { body: JSON.stringify(styles), contentType: "application/json" });
    await page.screenshot({ path: testInfo.outputPath("feedback-create.png"), fullPage: true });
    const box = await page.getByRole("dialog").boundingBox();
    expect(box?.width).toBeLessThanOrEqual(viewport.width);
  });
}

test("confirmed deletion removes the cached detail and refreshes the list", async ({ page }, testInfo) => {
  await login(page);
  const title = `删除同步 ${Date.now()}`;
  const created = await page.request.post("/api/feedback", {
    data: {
      requestId: crypto.randomUUID(),
      title,
      kind: "bug",
      module: "反馈",
      description: "删除前的原始说明",
      environment: {},
    },
  });
  expect(created.ok()).toBeTruthy();
  const item = (await created.json()).item;
  let removed = false;
  await page.route(`**/api/feedback/${item.id}`, async (route) => {
    if (removed && route.request().method() === "GET") {
      await route.fulfill({ status: 404, json: { error: "反馈已删除" } });
    } else await route.continue();
  });
  await page.route("**/api/feedback?*", async (route) => {
    if (!removed) return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({
      response,
      json: {
        ...payload,
        items: payload.items.filter((entry: { id: string }) => entry.id !== item.id),
        total: Math.max(0, payload.total - 1),
      },
    });
  });
  await openFeedback(page);
  await filterColumn(page, "反馈内容", title);
  await page.getByRole("button", { name: `查看反馈 #${item.number}：${title}`, exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText("删除前的原始说明");
  removed = true;
  await drawer.getByRole("button", { name: "同步 Gitea", exact: true }).click();
  await expect(drawer.getByText("反馈已删除", { exact: true })).toBeVisible();
  await expect(drawer.getByText("删除前的原始说明", { exact: true })).toHaveCount(0);
  await expect(drawer.getByLabel("追加说明内容")).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "重试", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("feedback-deleted-detail.png") });
  await drawer.getByRole("button", { name: "返回列表", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: `查看反馈 #${item.number}：${title}`, exact: true })).toHaveCount(0);
  await expect(page.getByText("暂无反馈记录", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("feedback-deleted-list.png") });
});
