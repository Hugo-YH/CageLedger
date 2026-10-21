import { ensureTestInfrastructure, expect, openIntakeEntry, test } from "./fixtures";

test("intake sex defaults, recognition and manual choices persist across both purposes", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await openIntakeEntry(page);
  const sex = page.getByRole("combobox", { name: "性别", exact: true });
  const selection = page.locator(".ant-select").filter({ has: sex });
  await expect(selection).toHaveText("雌性/雄性");
  await sex.click();
  await expect(page.locator(".ant-select-dropdown:visible .ant-select-item-option-content")).toHaveText([
    "雌性",
    "雄性",
    "雌性/雄性",
  ]);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(selection).toHaveText("雄性");

  await page.getByLabel("预约消息").fill("性别：female\n数量：10\n到货直接取材");
  await page.getByRole("button", { name: "本地识别", exact: true }).click();
  await expect(selection).toHaveText("雌性");
  await expect(page.getByRole("heading", { name: "直接取材预约", exact: true })).toBeVisible();
  await page.getByLabel("预约消息").fill("数量：10\n到货直接取材，性别未注明");
  await page.getByRole("button", { name: "本地识别", exact: true }).click();
  await expect(selection).toHaveText("雌性/雄性");

  let aiSex: string | undefined = "M";
  await page.route("**/api/intake/ai-parse", (route) =>
    route.fulfill({
      json: {
        item: {
          intakePurpose: "direct_sampling",
          batchNo: `SEX-${Date.now()}`,
          supplier: "性别选择测试供应商",
          quantity: 10,
          intakeDate: "2026-10-22",
          iacuc: "Z2026001",
          pi: "负责人",
          owner: "实验负责人",
          sex: aiSex,
        },
      },
    }),
  );
  await page.getByRole("button", { name: "AI识别", exact: true }).click();
  await expect(selection).toHaveText("雄性");
  aiSex = undefined;
  await page.getByRole("button", { name: "AI识别", exact: true }).click();
  await expect(selection).toHaveText("雌性/雄性");
  await sex.click();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(selection).toHaveText("雌性");
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/intake-batches") && r.request().method() === "POST");
  await page.getByRole("button", { name: "保存待接收批次", exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  const { item } = await response.json();
  try {
    expect(item.sex).toBe("雌性");
    const read = await page.request.get(`/api/intake-batches/${item.id}`);
    const data = await read.json();
    expect((data.item ?? data).sex).toBe("雌性");
    await expect(selection).toHaveText("雌性/雄性");
  } finally {
    await page.request.delete(`/api/intake-batches/${item.id}`);
  }
});
