import { expect, openQuantityEntry, test } from "./fixtures";

test("theme, motion and mobile breakpoint changes preserve drafts and usable control geometry", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await openQuantityEntry(page);
  const project = page.getByRole("textbox", { name: "项目名称", exact: true });
  await project.fill("切换主题和屏幕后保留的草稿");
  const room = page
    .getByRole("combobox", { name: "房间号", exact: true })
    .locator("xpath=ancestor::*[contains(@class,'ant-select')][last()]");
  const save = page.getByRole("button", { name: "保存统计表", exact: true });

  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: colorScheme === "dark" ? "reduce" : "no-preference" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    for (const width of [768, 767, 390, 1180]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(project).toHaveValue("切换主题和屏幕后保留的草稿");
      await expect(project).toHaveCSS("font-size", width < 768 ? "16px" : "14px");
      await expect(room).toHaveCSS("height", width < 768 ? "40px" : "32px");
      await expect(save).toHaveCSS("height", width < 768 ? "44px" : "32px");
      await project.focus();
      await page.keyboard.press("End");
      await expect(project).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      if (width === 390) {
        await page.getByRole("tab", { name: "更多", exact: true }).click();
        const sheet = page.locator(".ant-mobile-navigation-sheet");
        await expect(sheet).toBeInViewport({ ratio: 1 });
        for (const button of await sheet.getByRole("button").all()) {
          const bounds = await button.boundingBox();
          expect(bounds?.height).toBeGreaterThanOrEqual(44);
          expect(bounds?.width).toBeGreaterThanOrEqual(44);
        }
        const evidence = await sheet.evaluate((element) => ({
          color: getComputedStyle(element).color,
          background: getComputedStyle(element).getPropertyValue("--adm-color-background").trim(),
          expectedBackground: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
        }));
        expect(evidence.background).toBe(evidence.expectedBackground);
        await testInfo.attach(`mobile-navigation-${colorScheme}-style`, {
          body: JSON.stringify(evidence),
          contentType: "application/json",
        });
        await page.screenshot({
          path: testInfo.outputPath(`mobile-navigation-${colorScheme}.png`),
          animations: "disabled",
        });
        await sheet.getByRole("button", { name: "关闭", exact: true }).click();
        await expect(sheet).toBeHidden();
      }
    }
  }
});
