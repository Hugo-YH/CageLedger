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
