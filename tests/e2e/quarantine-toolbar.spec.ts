import { expect, openNavigationEntry, test } from "./fixtures";

test("quarantine selection survives pagination and clears when date or status scope changes", async ({
  page,
}, testInfo) => {
  const sources = Array.from({ length: 31 }, (_, index) => ({
    id: `toolbar-source-${index + 1}`,
    batchNo: `工具栏来源-${index + 1}`,
    intakeDate: "2026-09-09",
    supplier: "检疫选择测试供应商",
    strainStandard: "C57BL/6J",
    species: "mouse",
    quantity: 5,
    pi: "选择范围测试课题组",
    quarantineStatus: "待检疫",
  }));
  await page.route("**/api/quarantine/sources?**", (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get("offset"));
    return route.fulfill({
      json: {
        items: sources.slice(offset, offset + 30),
        page: { total: sources.length, offset, limit: 30, hasMore: offset === 0 },
      },
    });
  });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await openNavigationEntry(page, "检疫管理", "检疫批次");
  const toolbar = page.getByRole("group", { name: "待检疫列表操作", exact: true });
  const filters = page.getByRole("group", { name: "待检疫列表操作筛选", exact: true });
  await expect(toolbar).toHaveCount(1);
  await expect(toolbar).toContainText("已选 0 项");
  await expect(toolbar).toHaveCSS("position", "relative");
  await page
    .getByRole("row")
    .filter({ has: page.getByText("工具栏来源-1", { exact: true }) })
    .getByRole("checkbox")
    .check();
  await expect(toolbar).toContainText("已选 1 项");
  await page.locator(".ant-pagination-item-2").click();
  await page.getByRole("row").filter({ hasText: "工具栏来源-31" }).getByRole("checkbox").check();
  await expect(toolbar).toContainText("已选 2 项");
  await expect(toolbar.locator(".ant-btn-primary")).toHaveCount(1);
  await expect(toolbar.getByRole("button", { name: "用所选动物新建检疫批次（2）" })).toBeEnabled();

  for (const [width, height] of [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(toolbar).toHaveCSS("position", height <= 500 ? "relative" : "sticky");
    await expect(filters).toHaveCSS("position", "static");
    const metrics = await toolbar.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        display: style.display,
        columns: style.gridTemplateColumns,
        gap: style.gap,
        minWidth: style.minWidth,
        overflow: style.overflow,
        position: style.position,
        zIndex: style.zIndex,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        toolbarOverflow: element.scrollWidth > element.clientWidth,
      };
    });
    expect(metrics.pageOverflow).toBe(false);
    expect(metrics.toolbarOverflow).toBe(false);
    await testInfo.attach(`selected-toolbar-${width}-computed-style`, {
      body: JSON.stringify(metrics),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath(`selected-toolbar-${width}.png`) });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  for (const name of ["检疫池接收起始日期", "检疫池接收结束日期"]) {
    await page.getByRole("textbox", { name, exact: true }).fill("2026-09-09");
    await page.getByRole("textbox", { name, exact: true }).press("Enter");
    await expect(toolbar).toContainText("已选 0 项");
    await expect(page.getByText("范围已变化，已清空选择", { exact: true }).last()).toBeVisible();
    await expect(toolbar).toHaveCSS("position", "relative");
    await page
      .getByRole("row")
      .filter({ has: page.getByText("工具栏来源-1", { exact: true }) })
      .getByRole("checkbox")
      .check();
    await expect(toolbar).toContainText("已选 1 项");
  }
  await page.getByRole("combobox", { name: "检疫池范围", exact: true }).click();
  await page
    .locator(".ant-select-dropdown")
    .filter({ visible: true })
    .getByText("全部已接收动物", { exact: true })
    .click();
  await expect(toolbar).toContainText("已选 0 项");
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "清空选择", exact: true })).toBeDisabled();
});
