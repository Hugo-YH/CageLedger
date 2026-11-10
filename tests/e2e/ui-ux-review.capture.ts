import { writeFileSync } from "node:fs";
import { openAuthenticatedAuditPage } from "./auditSession";
import { expect, openNavigationEntry, openSavedQuantitySheets, test } from "./fixtures";

// Explicit review only: captures use a fresh test database and never publish media.
const entries = [
  ["entry", "", "总览"],
  ["intake", "笼卡管理", "预约消息识别"],
  ["intake", "笼卡管理", "待接收批次"],
  ["intake", "笼卡管理", "二维码扫描"],
  ["reception", "接收管理", "接收列表"],
  ["reception", "检疫管理", "检疫批次"],
  ["reception", "检疫管理", "寄生虫检测"],
  ["reception", "检疫管理", "ELISA检测"],
  ["reception", "检疫管理", "PCR检测"],
  ["reception", "检疫管理", "检疫报告"],
  ["cages", "", "笼位管理"],
  ["animal", "动物管理", "动物巡检"],
  ["animal", "动物管理", "异常处置"],
  ["animal", "动物管理", "巡检记录"],
  ["animal", "动物管理", "巡检标准"],
  ["fees", "饲养费管理", "录入数量统计表"],
  ["fees", "饲养费管理", "已保存数量统计表"],
  ["fees", "技术服务费管理", "录入技术服务明细"],
  ["fees", "技术服务费管理", "已保存技术服务明细"],
  ["settlement", "结算管理", "结算列表"],
  ["settlement", "结算管理", "单据跟踪"],
  ["settlement", "结算管理", "汇总导出"],
  ["settings", "", "帮助与反馈"],
  ["settings", "系统设置", "房间管理"],
  ["settings", "系统设置", "实验人员信息"],
  ["settings", "系统设置", "关于系统"],
  ["settings", "系统设置", "系统功能"],
  ["settings", "系统设置", "数据管理"],
  ["settings", "系统设置", "数据核查"],
  ["settings", "系统设置", "账号管理"],
  ["settings", "系统设置", "操作日志"],
] as const;
const selectedModule = process.env.UI_UX_MODULE || "all";
const widths = (process.env.UI_UX_WIDTHS || "1280,1440,1920").split(",").map(Number);
const phase = process.env.UI_UX_PHASE || "review";
const colorScheme = process.env.UI_UX_THEME === "dark" ? "dark" : "light";
const pageTitles: Record<string, string> = {
  总览: "实验动物笼位管理与计费系统",
  预约消息识别: "接收笼卡",
  待接收批次: "待接收批次列表",
  二维码扫描: "识别笼卡",
  巡检标准: "巡检标准目录",
  房间管理: "饲养间与笼架",
  关于系统: "系统状态",
};

test.beforeEach(async ({ page }) => {
  const response = await page.request.get("/api/health");
  expect(response.ok()).toBe(true);
  const health = await response.json();
  expect(String(health.database)).toContain("cageledger-e2e-");
});

for (const width of widths) {
  test(`UI review ${selectedModule} ${phase} ${width}`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await openAuthenticatedAuditPage(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    const evidence = [];
    for (const [module, group, label] of entries) {
      if (selectedModule !== "all" && selectedModule !== module) continue;
      if (group) await openNavigationEntry(page, group, label);
      else
        await page
          .locator(".ant-main-menu")
          .getByRole("menuitem", { name: new RegExp(label) })
          .click();
      await expect(page.locator('[data-ui="page-skeleton"]')).toHaveCount(0);
      await expect(page.locator(".app-command-bar-title-page")).toHaveText(pageTitles[label] || label);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.locator("main.workspace").evaluate((main) => {
        const heading = main.querySelector(".app-command-bar-title-page")!;
        return {
          title: heading.textContent,
          fontSize: getComputedStyle(heading).fontSize,
          lineHeight: getComputedStyle(heading).lineHeight,
          workspaceOverflow: main.scrollWidth > main.clientWidth + 1,
          documentOverflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(geometry.documentOverflow, label).toBe(false);
      expect(geometry.workspaceOverflow, label).toBe(false);
      expect(geometry.fontSize, label).toBe("24px");
      expect(parseFloat(geometry.lineHeight), label).toBeCloseTo(32, 2);
      await page.screenshot({ path: info.outputPath(`${label}.png`), animations: "disabled" });
      evidence.push({ module, label, width, colorScheme, ...geometry });
    }
    expect(evidence.length).toBeGreaterThan(0);
    writeFileSync(info.outputPath("review.json"), JSON.stringify(evidence, null, 2));
  });
}

test("shared loading respects live reduced-motion preferences without replacing its region", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openAuthenticatedAuditPage(page);
  await openSavedQuantitySheets(page);
  await expect(page.locator('[data-ui="page-skeleton"]')).toHaveCount(0);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/quantity-sheets?*", async (route) => {
    await gate;
    await route.fallback();
  });
  try {
    await page.reload();
    const region = page.getByRole("status", { name: "已保存数量统计表正在加载", exact: true });
    await expect(region).toBeVisible();
    await expect(region.locator(".ant-skeleton-active")).toHaveCount(0);
    const original = await region.elementHandle();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(region.locator(".ant-skeleton-active").first()).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(region.locator(".ant-skeleton-active")).toHaveCount(0);
    expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
    await page.screenshot({ path: info.outputPath("loading-reduced-motion.png"), animations: "disabled" });
  } finally {
    release();
  }
  await expect(page.locator('[data-ui="page-skeleton"]')).toHaveCount(0);
});
