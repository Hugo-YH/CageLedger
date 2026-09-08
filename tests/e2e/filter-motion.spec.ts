import { expect, openNavigationEntry, test } from "./fixtures";

const viewports = [
  { width: 1440, height: 900 },
  { width: 1180, height: 900 },
  { width: 760, height: 900 },
  { width: 844, height: 390 },
];

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  for (const viewport of viewports) {
    test(`column filters stay onscreen: ${reducedMotion} ${viewport.width}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion });
      await page.goto("/app");
      await page.getByLabel("用户名", { exact: true }).fill("admin");
      await page.getByLabel("密码", { exact: true }).fill("admin123");
      await page.getByRole("button", { name: "登录", exact: true }).click();
      for (const [group, label, filter] of [
        ["笼卡管理", "待接收批次", "批次号"],
        ["饲养费管理", "已保存数量统计表", "IACUC"],
        ["饲养费管理", "结算管理", "项目负责人姓名"],
        ["饲养费管理", "单据跟踪", "状态"],
      ]) {
        await openNavigationEntry(page, group, label);
        const trigger = page.getByRole("button", { name: `筛选${filter}`, exact: true });
        await trigger.click();
        const input = page.getByPlaceholder("搜索当前列");
        await expect(input).toBeInViewport();
        await input.fill("检查筛选");
        await expect(input).toHaveValue("检查筛选");
        const panel = page.locator(".ant-popover").filter({ has: input });
        await testInfo.attach(`${label}-geometry`, {
          body: JSON.stringify(
            await panel.evaluate((element) => {
              const style = getComputedStyle(element);
              return {
                rect: element.getBoundingClientRect().toJSON(),
                position: style.position,
                display: style.display,
                zIndex: style.zIndex,
                transitionProperty: style.transitionProperty,
                transitionDuration: style.transitionDuration,
                scrollWidth: element.scrollWidth,
                clientWidth: element.clientWidth,
              };
            }),
          ),
          contentType: "application/json",
        });
        await testInfo.attach(`${label}-open`, { body: await page.screenshot(), contentType: "image/png" });
        await page.getByRole("button", { name: "应用", exact: true }).click();
        await expect(input).toBeHidden();
        await trigger.focus();
        await page.keyboard.press("Enter");
        await expect(input).toBeInViewport();
        await expect(input).toHaveValue("");
        await page.getByRole("button", { name: "应用", exact: true }).click();
        await expect(input).toBeHidden();
      }
    });
  }
}
