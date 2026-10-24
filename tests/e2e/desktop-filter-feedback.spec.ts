import type { Route } from "@playwright/test";

import { expect, openNavigationEntry, test } from "./fixtures";

for (const [group, label, columnLabel] of [
  ["笼卡管理", "待接收批次", "项目负责人"],
  ["饲养费管理", "已保存数量统计表", "负责人"],
  ["结算管理", "单据跟踪", "项目负责人"],
]) {
  test(`desktop ${label} filter recovers from failure without applying unfinished choices`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1180, height: 800 });
    let mode: "error" | "hold" | "ready" = "error";
    let held: Route | undefined;
    await page.route("**/api/filter-options?*", async (route) => {
      if (mode === "hold") {
        held = route;
        return;
      }
      await route.fulfill(
        mode === "error"
          ? { status: 503, json: { error: "筛选服务暂时不可用" } }
          : { json: { items: [{ value: "example-pi", label: "筛选回归示例负责人", count: 1 }] } },
      );
    });
    await page.goto("/app");
    await page.getByLabel("用户名", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("admin123");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
    await openNavigationEntry(page, group, label);
    const trigger = page.getByRole("button", { name: `筛选${columnLabel}`, exact: true });
    await trigger.click();
    const panel = page.getByRole("group", { name: `筛选${columnLabel}选项`, exact: true });
    await expect(panel.getByRole("alert")).toContainText("筛选选项加载失败");
    await expect(panel).not.toContainText("当前列没有可选项");
    await page.screenshot({ path: info.outputPath("filter-error.png"), animations: "disabled" });
    mode = "hold";
    await panel.getByRole("button", { name: "重试", exact: true }).click();
    await expect(panel.getByRole("status", { name: `${columnLabel}筛选选项正在加载` })).toBeVisible();
    await expect(panel).toHaveAttribute("aria-busy", "true");
    await expect.poll(() => Boolean(held)).toBe(true);
    await page.screenshot({ path: info.outputPath("filter-loading.png"), animations: "disabled" });
    await panel.getByRole("searchbox", { name: `搜索${columnLabel}筛选选项`, exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    mode = "ready";
    await held!.fulfill({ json: { items: [{ value: "late-pi", label: "迟到的筛选样例", count: 1 }] } });
    await expect(trigger).toHaveAttribute("aria-pressed", "false");
    await trigger.press("Enter");
    const search = panel.getByRole("searchbox", { name: `搜索${columnLabel}筛选选项`, exact: true });
    await expect(search).toHaveValue("");
    await expect(panel).toHaveAttribute("aria-busy", "false");
    const option = panel.getByRole("checkbox", { name: /筛选回归示例负责人|迟到的筛选样例/ }).first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(option).toBeChecked();
    await search.fill("没有这个负责人");
    await expect(panel.getByRole("status")).toContainText("没有匹配的筛选项");
    await expect(trigger).toHaveAttribute("aria-pressed", "false");
    await search.fill("");
    await panel.getByRole("button", { name: "应用", exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-pressed", "true");
    await expect(trigger).toBeFocused();
  });
}
