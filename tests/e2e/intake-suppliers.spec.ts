import { expect, openIntakeEntry, test } from "./fixtures";

test("local and AI supplier recognition share regional aliases without collapsing branches", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await openIntakeEntry(page);
  let supplier = "";
  await page.route("**/api/intake/ai-parse", (route) =>
    route.fulfill({ json: { item: { supplier, intakePurpose: "direct_sampling", quantity: 10 } } }),
  );
  const cases = [
    ["斯贝福（北京）生物技术有限公司", "北京斯贝福"],
    ["北京维通利华实验动物技术有限公司湖北分公司", "湖北维通利华"],
    ["湖南斯莱克景达实验动物有限公司", "湖南斯莱克景达"],
    ["百奥赛图江苏基因生物技术有限公司", "江苏百奥赛图"],
    ["深圳百奥赛图生物科技有限公司", "深圳百奥赛图生物科技有限公司"],
    ["未收录实验动物供应单位", "未收录实验动物供应单位"],
  ];
  for (const [raw, shortName] of cases) {
    supplier = raw;
    await page.getByLabel("预约消息").fill(`供应商：${raw}\n数量：10\n到货直接取材`);
    await page.getByRole("button", { name: "本地识别", exact: true }).click();
    await expect(page.getByLabel("购买单位", { exact: true })).toHaveValue(shortName);
    await page.getByLabel("购买单位", { exact: true }).fill("待核对");
    await page.getByRole("button", { name: "AI识别", exact: true }).click();
    await expect(page.getByLabel("购买单位", { exact: true })).toHaveValue(shortName);
  }
});
