import { captureUiAudit } from "./uiAudit";
import { expect, test } from "./fixtures";

test("project portal provides product and Gitea resource entry points", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "进入系统" }).first()).toHaveAttribute("href", "/app");
  await expect(page.getByRole("link", { name: "Gitea" }).first()).toHaveAttribute(
    "href",
    "https://git.cellnucle.us/hugo/cageledger",
  );
  await expect(page.getByRole("heading", { name: "围绕实验动物中心日常工作的统一系统", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "文档、版本与部署资源", level: 2 })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开资源" }).first()).toHaveAttribute("href", "/docs/");
  await expect(page.getByRole("heading", { name: "单据跟踪", level: 4, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开资源" }).nth(1)).toHaveAttribute(
    "href",
    "https://git.cellnucle.us/hugo/cageledger/releases",
  );
  await captureUiAudit(page, testInfo, "project-portal");
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 960 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`project-portal-${width}-full.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
});

test("project portal preserves readable mobile, dark, and reduced-motion layouts", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "进入系统" }).first()).toBeVisible();
  await expect(page.locator(".project-home-nav")).toBeHidden();
  await expect(page.locator("html")).toHaveCSS("--cl-motion-fast", "0s");
  await expect(page.locator(".project-hero-copy")).toHaveCSS("animation-name", "none");
  expect(
    await page
      .getByRole("link", { name: "进入系统" })
      .first()
      .evaluate((element) =>
        getComputedStyle(element)
          .transitionDuration.split(", ")
          .every((value) => value === "0.001s"),
      ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("project-portal-390-dark-full.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("project portal uses the shared finite motion contract", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");

  await expect(page.locator("html")).toHaveCSS("--cl-motion-fast", "0.15s");
  await expect(page.locator("html")).toHaveCSS("--motion-base", "0.2s");
  await expect(page.locator("html")).toHaveCSS("--motion-slow", "0.25s");
  await expect(page.locator(".project-hero-copy")).toHaveCSS("animation-name", "none");

  const decorativeMotion = page.locator(".project-demo-flow-line span, .project-demo-cage.is-active");
  expect(await decorativeMotion.count()).toBeGreaterThan(0);
  for (const element of await decorativeMotion.all()) {
    await expect(element).toHaveCSS("animation-name", "none");
  }
});
