import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test("documentation portal link returns to the project home", async ({ page }) => {
  await page.goto("/docs/");

  const projectHome = page.getByRole("link", { name: "项目门户", exact: true });
  await expect(projectHome).toHaveAttribute("href", "/");
  await expect(projectHome).toHaveAttribute("target", "_self");
  await projectHome.click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
});

test("documentation edit link uses Gitea's file edit route", async ({ page }) => {
  await page.goto("/docs/LLMs");

  await expect(page.getByRole("link", { name: "编辑此页", exact: true })).toHaveAttribute(
    "href",
    "https://git.cellnucle.us/hugo/cageledger/_edit/main/wiki/LLMs.md",
  );
});

test("rewritten documentation routes edit their source file on main", async ({ page }) => {
  await page.goto("/docs/operations/https-and-certificate");

  await expect(page.getByRole("link", { name: "编辑此页", exact: true })).toHaveAttribute(
    "href",
    "https://git.cellnucle.us/hugo/cageledger/_edit/main/wiki/HTTPS与证书.md",
  );
});

test("documentation exposes the machine index as llms.txt instead of a footer self-link", async ({ page }) => {
  await page.goto("/docs/LLMs");

  await expect(page.locator(".cageledger-doc-llms-link")).toHaveCount(0);
  const response = await page.request.get("/docs/llms.txt");
  expect(response.ok()).toBe(true);
  await expect(response.text()).resolves.toContain("# CageLedger 文档");
});

test("documentation reading paths expose their task navigation", async ({ page }) => {
  for (const [route, heading] of [
    ["guide", "使用指南"],
    ["operations", "部署与运维"],
    ["development", "开发维护"],
  ]) {
    await page.goto(`/docs/${route}/`);
    await expect(page.locator(".vp-doc h1")).toHaveText(heading);
    await expect(page.locator(".VPSidebar a[href]").first()).toHaveAttribute("href", `/docs/${route}/`);
    expect(await page.locator(".vp-doc a[href]").count()).toBeGreaterThan(4);
  }
});

test("documentation figures and tables remain usable across themes and viewports", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 1180, height: 900 },
    { width: 760, height: 900 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/docs/");
    await expect(page.getByRole("link", { name: "开始使用", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`docs-home-${viewport.width}.png`) });
    await page.goto("/docs/guide/quantity-sheets");
    const figure = page.locator(".doc-figure");
    await figure.scrollIntoViewIfNeeded();
    await expect(figure.locator("img")).toHaveJSProperty("naturalWidth", 1440);
    await expect(figure.getByRole("link")).toHaveAttribute("href", "/docs/screenshots/quantity-sheets.png");
    await figure.getByRole("link").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(figure.getByRole("link")).toBeFocused();
    await expect(figure.getByRole("link")).not.toHaveCSS("outline-style", "none");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`docs-figure-${viewport.width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/docs/guide/business-flow");
  const diagram = page.locator(".doc-figure img");
  await diagram.scrollIntoViewIfNeeded();
  await expect(diagram).toHaveJSProperty("naturalWidth", 984);
  const lightAccessibility = await new AxeBuilder({ page })
    .include(".VPContent")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(lightAccessibility.violations).toEqual([]);
  await page.getByRole("switch").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--cl-color-surface").trim()),
    )
    .toBe("#141414");
  await page.screenshot({ path: testInfo.outputPath("docs-diagram-dark.png") });
  const darkAccessibility = await new AxeBuilder({ page })
    .include(".VPContent")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(darkAccessibility.violations).toEqual([]);
  await page.goto("/docs/development/api-inventory");
  await page.setViewportSize({ width: 390, height: 844 });
  const table = page.getByRole("region", { name: "表格，可横向滚动查看", exact: true }).first();
  await table.scrollIntoViewIfNeeded();
  await table.focus();
  await expect(table).toBeFocused();
  const overflow = await table.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("docs-table-mobile-dark.png") });
});
