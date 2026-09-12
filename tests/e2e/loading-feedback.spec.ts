import { expect, openNavigationEntry, test } from "./fixtures";
import { randomUUID } from "node:crypto";

test("batch search retains rows, recovers from failure, and loads the catalog on detail entry", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeHidden();
  const batchName = `refresh-${randomUUID()}`;
  const created = await page.request.post("/api/quarantine/batches", {
    data: { item: { id: randomUUID(), name: batchName, sources: [{ id: "s", supplier: "哨兵鼠", species: "小鼠" }] } },
  });
  expect(created.ok()).toBe(true);
  await openNavigationEntry(page, "检疫管理", "寄生虫检测");
  const row = page.getByRole("row").filter({ hasText: batchName });
  await expect(row).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let fail = true;
  await page.route("**/api/quarantine/batches?*", async (route) => {
    await gate;
    if (fail) await route.fulfill({ status: 503, json: { error: "测试暂时不可用" } });
    else await route.fallback();
  });
  const search = page.getByRole("searchbox", { name: "搜索检疫批次", exact: true });
  await search.fill(batchName);
  await search.press("Enter");
  await expect(page.getByText("正在更新，暂显示上次结果", { exact: true })).toBeVisible();
  await expect(row).toBeVisible();
  await expect(search).toBeEnabled();
  release();
  await expect(page.getByText("测试暂时不可用", { exact: true })).toBeVisible({ timeout: 15000 });
  fail = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "查看检测记录" }).click();
  await expect(page.getByRole("button", { name: "新建检测记录", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "新建检测记录", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存检测草稿", exact: true })).toBeVisible();
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 1180, height: 900 },
  { width: 760, height: 900 },
  { width: 844, height: 390 },
  { width: 390, height: 844 },
]) {
  test.describe(`loading feedback ${size.width}`, () => {
    test.use({ hasTouch: size.width === 390 });
    test("cold placeholder and retained refresh remain operable", async ({ page }, testInfo) => {
      await page.setViewportSize(size);
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: size.width === 1180 ? "dark" : "light" });
      let release!: () => void;
      let responseGate = new Promise<void>((resolve) => (release = resolve));
      const requests: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/quarantine/")) requests.push(request.url());
      });
      await page.route("**/api/quarantine/sources?*", async (route) => {
        await responseGate;
        await route.fulfill({ json: { items: [], page: { total: 0, limit: 30, offset: 0 } } });
      });
      await page.goto("/app");
      await page.getByLabel("用户名", { exact: true }).fill("admin");
      await page.getByLabel("密码", { exact: true }).fill("admin123");
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await openNavigationEntry(page, "检疫管理", "检疫批次");
      const skeleton = page.getByRole("status", { name: "待检疫列表正在加载" });
      await expect(skeleton).toBeVisible();
      await expect(skeleton.locator(".page-skeleton-table .ant-skeleton-input")).toHaveCount(44);
      const buttonStyle = await page.getByRole("button", { name: "新建检疫批次", exact: true }).evaluate((button) => ({
        height: button.getBoundingClientRect().height,
        transition: getComputedStyle(button).transitionDuration,
      }));
      const styles = await skeleton.evaluate((element, buttonStyle) => {
        const grid = element.querySelector(".page-skeleton-table-row")!;
        const control = document.querySelector('[aria-label="检疫池接收起始日期"]')!.closest(".ant-picker")!;
        return {
          display: getComputedStyle(grid).display,
          columns: getComputedStyle(grid).gridTemplateColumns,
          gap: getComputedStyle(grid).gap,
          minWidth: getComputedStyle(grid).minWidth,
          position: getComputedStyle(element).position,
          zIndex: getComputedStyle(element).zIndex,
          overflow: document.documentElement.scrollWidth > innerWidth,
          inputHeight: control.getBoundingClientRect().height,
          buttonHeight: buttonStyle.height,
          animation: getComputedStyle(element.querySelector(".ant-skeleton-input")!, "::after").animationName,
          transition: buttonStyle.transition,
        };
      }, buttonStyle);
      expect(styles.overflow).toBe(false);
      expect(styles.inputHeight).toBe(32);
      expect(styles.buttonHeight).toBe(32);
      expect(styles.animation).toBe("none");
      await testInfo.attach("loading-computed-style", {
        body: JSON.stringify(styles),
        contentType: "application/json",
      });
      await page.screenshot({ path: testInfo.outputPath("loading.png"), fullPage: true });
      expect(requests.some((url) => /\/quarantine\/(catalog|batches)/.test(url))).toBe(false);
      release();
      await expect(skeleton).toBeHidden();
      responseGate = new Promise<void>((resolve) => (release = resolve));
      await page.getByRole("combobox", { name: "检疫池范围" }).click();
      await page.getByTitle("全部已接收动物", { exact: true }).click();
      await expect(page.getByText("正在更新，暂显示上次结果", { exact: true })).toBeVisible();
      await expect(skeleton).toBeHidden();
      await expect(page.locator(".ant-table")).toBeVisible();
      const date = page.getByRole("textbox", { name: "检疫池接收起始日期" });
      await date.click();
      await expect(page.locator(".ant-picker-dropdown").filter({ visible: true })).toBeInViewport();
      await page.keyboard.press("Escape");
      await page.screenshot({ path: testInfo.outputPath("refresh.png"), fullPage: true });
      release();
      await expect(page.getByText("正在更新，暂显示上次结果", { exact: true })).toBeHidden();
    });
  });
}
