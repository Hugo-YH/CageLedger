import { expect, openSettingsView, test } from "./fixtures";

for (const [width, height] of [
  [1440, 900],
  [1180, 820],
  [760, 900],
  [390, 844],
]) {
  test(`operation feedback separates notification, message and contextual error at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height });
    expect(
      (await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } })).ok(),
    ).toBe(true);
    const health = await (await page.request.get("/api/health")).json();
    expect(health.database).toContain("cageledger-e2e-");
    const original = (await (await page.request.get("/api/system/features")).json()).item;
    try {
      await page.goto("/app");
      if (width < 768) {
        await page.getByRole("tab", { name: "更多", exact: true }).click();
        await page.locator(".ant-mobile-navigation-sheet").getByText("系统功能", { exact: true }).click();
      } else await openSettingsView(page, "系统功能");
      const feature = page.getByRole("switch", { name: "检疫管理", exact: true });
      await feature.click();
      await page.getByRole("button", { name: "刷新", exact: true }).click();
      const message = page.getByText("已刷新服务器配置，未覆盖当前未保存的修改。", { exact: true });
      await expect(message).toHaveCount(1);
      const messageBox = await message.boundingBox();
      expect(await feature.getAttribute("aria-checked")).toBe(String(!original.enabled.quarantine));
      await page.route("**/api/system/features", async (route) => {
        if (route.request().method() === "PUT") {
          await route.fulfill({ status: 503, json: { error: "设置保存暂时不可用，请重试" } });
        } else await route.fallback();
      });
      const save = page.getByRole("button", { name: "保存设置", exact: true });
      await save.click();
      const error = page.locator(".system-features-page .ant-alert-error").filter({ hasText: "设置保存暂时不可用" });
      await expect(error).toBeVisible();
      await expect(page.locator(".ant-notification-notice")).toHaveCount(0);
      await expect(save).toBeEnabled();
      await page.unroute("**/api/system/features");
      await save.focus();
      await save.press("Enter");
      const notice = page.locator(".ant-notification-notice").filter({ hasText: "系统功能设置已保存" });
      await expect(notice).toHaveCount(1);
      await expect(notice).toHaveAttribute("role", "status");
      await expect(error).toHaveCount(0);
      const host = page.locator(width < 768 ? ".ant-notification-top" : ".ant-notification-topRight");
      await expect(host).toBeVisible();
      const geometryOfNotice = () =>
        notice.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            top: box.top,
            width: box.width,
            viewport: innerWidth,
            zIndex: getComputedStyle(element.closest(".ant-notification")!).zIndex,
          };
        });
      await expect
        .poll(async () => {
          const box = await geometryOfNotice();
          return (
            box.left >= 0 && box.right <= width && box.top >= (messageBox ? messageBox.y + messageBox.height + 8 : 0)
          );
        })
        .toBe(true);
      const geometry = await geometryOfNotice();
      await info.attach(`feedback-layout-${width}`, {
        body: JSON.stringify(geometry),
        contentType: "application/json",
      });
      await page.screenshot({ path: info.outputPath(`feedback-${width}.png`), animations: "disabled" });
      await notice.hover();
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(notice).toBeVisible();
      await page.screenshot({ path: info.outputPath(`feedback-dark-${width}.png`), animations: "disabled" });
      await notice.getByRole("button", { name: "关闭通知", exact: true }).click();
      await expect(notice).toHaveCount(0);
      const saved = (await (await page.request.get("/api/system/features")).json()).item;
      expect(saved.enabled.quarantine).toBe(!original.enabled.quarantine);
    } finally {
      const current = (await (await page.request.get("/api/system/features")).json()).item;
      expect(
        (
          await page.request.put("/api/system/features", {
            data: { enabled: original.enabled, expectedUpdatedAt: current.updatedAt },
          })
        ).ok(),
      ).toBe(true);
    }
  });
}
