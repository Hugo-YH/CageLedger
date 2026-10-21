import {
  ensureTestInfrastructure,
  expect,
  openIntakeEntry,
  openNavigationEntry,
  selectAntOptionByKeyboard,
  test,
} from "./fixtures";
import type { Page } from "@playwright/test";

async function setDate(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.locator(".ant-picker-dropdown:visible").getByTitle(value, { exact: true }).click();
  await expect(page.locator(".ant-picker-dropdown:visible")).toHaveCount(0);
}

async function openEntry(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await openIntakeEntry(page);
}

test("intake dates stay linked while typing, clearing, saving and editing a batch", async ({ page }) => {
  await openEntry(page);
  const days = page.getByLabel("饲养周期（天）", { exact: true });
  const end = page.getByLabel("结束日期", { exact: true });
  await setDate(page, "接收日期", "2026-10-21");
  await days.pressSequentially("30");
  await expect(end).toHaveValue("2026-11-20");
  await days.fill("60");
  await expect(end).toHaveValue("2026-12-20");
  await setDate(page, "接收日期", "2026-10-25");
  await expect(end).toHaveValue("2026-12-24");
  await setDate(page, "结束日期", "2026-11-01");
  await expect(days).toHaveValue("7");
  const endPicker = page.locator(".ant-picker").filter({ has: end });
  await endPicker.hover();
  await endPicker.locator("button.ant-picker-clear").click();
  await expect(days).toHaveValue("");
  await expect(end).toHaveValue("");
  await days.fill("0");
  await expect(end).toHaveValue("2026-10-25");
  await days.fill("");
  await expect(end).toHaveValue("");
  await setDate(page, "结束日期", "2026-11-01");
  await expect(days).toHaveValue("7");

  const batchNo = `E2E-DATE-LINK-${Date.now()}`;
  await page.getByLabel("购买单位", { exact: true }).fill("日期联动测试供应商");
  await page.getByLabel("批次号", { exact: true }).fill(batchNo);
  await page.getByLabel("IACUC 编号", { exact: true }).fill("Z2026001");
  await page.getByLabel("项目负责人", { exact: true }).fill("日期联动负责人");
  await page.getByLabel("实验负责人", { exact: true }).fill("日期联动实验负责人");
  await selectAntOptionByKeyboard(page, page.getByRole("combobox", { name: "房间", exact: true }));
  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/intake-batches") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存待接收批次", exact: true }).click();
  const savedResponse = await saved;
  expect(savedResponse.ok()).toBe(true);
  const { item } = await savedResponse.json();
  try {
    expect(item).toMatchObject({ intakeDate: "2026-10-25", endDate: "2026-11-01", husbandryDays: 7 });
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    await page.locator("tr", { hasText: batchNo }).getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "编辑待接收批次", exact: true })).toBeVisible();
    await days.fill("14");
    await expect(end).toHaveValue("2026-11-08");
    const updated = page.waitForResponse(
      (response) => response.url().endsWith(`/api/intake-batches/${item.id}`) && response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "保存待接收批次", exact: true }).click();
    expect((await updated).ok()).toBe(true);
    const persisted = await page.request.get(`/api/intake-batches/${item.id}`);
    const data = await persisted.json();
    expect(data.item ?? data).toMatchObject({ intakeDate: "2026-10-25", endDate: "2026-11-08", husbandryDays: 14 });
  } finally {
    await page.request.delete(`/api/intake-batches/${item.id}`);
  }
});

test("AI recognized date ranges populate the cycle and remain editable", async ({ page }) => {
  await openEntry(page);
  await page.route("**/api/intake/ai-parse", (route) =>
    route.fulfill({
      json: {
        item: { batchNo: "AI-DATE-RANGE", intakeDate: "2028-02-28", endDate: "2028-03-01", husbandryDays: 2 },
      },
    }),
  );
  await page.getByLabel("预约消息").fill("2028年2月28日接收，3月1日结束饲养。");
  await page.getByRole("button", { name: "AI识别", exact: true }).click();
  await expect(page.getByLabel("接收日期", { exact: true })).toHaveValue("2028-02-28");
  await expect(page.getByLabel("结束日期", { exact: true })).toHaveValue("2028-03-01");
  const days = page.getByLabel("饲养周期（天）", { exact: true });
  await expect(days).toHaveValue("2");
  await days.fill("7");
  await expect(page.getByLabel("结束日期", { exact: true })).toHaveValue("2028-03-06");
  await setDate(page, "结束日期", "2028-03-02");
  await expect(days).toHaveValue("3");
});
