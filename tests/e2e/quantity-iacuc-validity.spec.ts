import { ensureTestInfrastructure, expect, openQuantityEntry, test } from "./fixtures";

test("IACUC validity bubbles follow expiry colors, reject stale hints and allow saving after red reminders", async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date(2026, 9, 19, 12));
  const items = [
    { iacuc: "E2E-VALID", projectStartDate: "2026-01-01", projectEndDate: "2028-12-31" },
    { iacuc: "E2E-SOON", projectStartDate: "2026-01-01", projectEndDate: "2026-12-01" },
    { iacuc: "E2E-EXPIRED", projectStartDate: "2025-01-01", projectEndDate: "2026-10-18" },
    { iacuc: "E2E-FUTURE", projectStartDate: "2026-10-20", projectEndDate: "2028-12-31" },
    { iacuc: "E2E-MISSING", projectEndDate: "2028-12-31" },
  ].map((item) => ({ ...item, project: "有效期提示测试", pi: "E2E 有效期负责人", owner: "负责人", funding: "TEST" }));
  await page.route("**/api/iacuc-index?*", (route) => {
    const code = new URL(route.request().url()).searchParams.get("q");
    return code === "E2E-FAIL"
      ? route.fulfill({ status: 403, json: { error: "暂时无法查询" } })
      : route.fulfill({ json: { items: items.filter((item) => item.iacuc === code) } });
  });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await openQuantityEntry(page);
  const input = page.getByRole("combobox", { name: "IACUC 编号", exact: true });
  const bubble = page.locator(".quantity-iacuc-validity .ant-tag");
  for (const [code, color, text] of [
    ["E2E-VALID", "blue", "2028-12-31 到期"],
    ["E2E-SOON", "warning", "即将到期"],
    ["E2E-EXPIRED", "error", "已到期"],
    ["E2E-FUTURE", "error", "尚未生效"],
    ["E2E-MISSING", "error", "未获取完整有效期"],
    ["E2E-UNKNOWN", "error", "未获取完整有效期"],
    ["E2E-FAIL", "error", "查询失败"],
  ]) {
    await input.fill(code);
    await expect(bubble).toHaveClass(new RegExp(`ant-tag-${color}`));
    await expect(bubble).toContainText(text);
  }
  await input.fill("");
  await expect(bubble).toHaveCount(0);
  await input.fill("E2E-FUTURE");
  await expect(bubble).toContainText("尚未生效");
  await bubble.focus();
  await expect(page.getByRole("tooltip")).toContainText("此提示不影响保存");
  await bubble.hover();
  await expect(page.locator(".ant-tooltip")).toHaveCSS("opacity", "1");
  await testInfo.attach("iacuc-validity-reminder", {
    body: await page.screenshot({ animations: "disabled" }),
    contentType: "image/png",
  });
  await page.getByRole("combobox", { name: "房间号", exact: true }).click();
  await page.locator(".ant-select-dropdown").getByText("8014", { exact: true }).click();
  await page.getByLabel("第 1 行结余笼数", { exact: true }).fill("2");
  await page.getByRole("button", { name: "保存统计表", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "确认保存数量统计表", exact: true });
  await expect(confirm).toBeVisible();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/quantity-sheets") && response.request().method() === "POST",
  );
  await confirm.getByRole("button", { name: "确认保存", exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBeTruthy();
  const sheet = (await response.json()).item;
  expect(sheet.iacuc).toBe("E2E-FUTURE");
  expect((await page.request.get(`/api/quantity-sheets/${sheet.id}`)).ok()).toBeTruthy();
  await expect(input).toHaveValue("");
  await expect(bubble).toHaveCount(0);
  await page.request.delete(`/api/quantity-sheets/${sheet.id}`);
});
