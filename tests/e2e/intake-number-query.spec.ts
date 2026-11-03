import { ensureTestInfrastructure, expect, openNavigationEntry, test } from "./fixtures";

test("demand number queries keep approval separate from receipt and retain invalid legacy numbers", async ({
  page,
}, info) => {
  const health = await page.request.get("/api/health");
  expect((await health.json()).database).toContain("cageledger-e2e-");
  const login = await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } });
  expect(login.ok()).toBe(true);
  await page.goto("/app");
  await ensureTestInfrastructure(page);
  for (const [index, batchNo] of [
    "(Z2025137)2026101406",
    "（Z2025137)2026101506",
    "（Z2025137）2026022906",
  ].entries()) {
    const result = await page.request.post("/api/intake-batches", {
      data: {
        item: {
          id: `number-query-${index}`,
          batchNo,
          iacuc: "Z2025137",
          species: "mouse",
          supplier: "合成测试供应商",
          pi: "合成负责人",
          owner: "合成责任人",
          roomName: "8014",
          intakeDate: "2026-11-03",
          quantity: 6,
          finalCardCount: 1,
          status: "pending_print",
          cards: [],
          receipts: [],
          rawMessage: "合成测试",
        },
      },
    });
    expect(result.ok(), await result.text()).toBe(true);
  }
  await openNavigationEntry(page, "笼卡管理", "待接收批次");
  await page.getByLabel("编号内 IACUC", { exact: true }).fill("z2025137");
  await page.getByLabel("批次序号", { exact: true }).fill("6");
  await page.getByRole("button", { name: "查询编号", exact: true }).click();
  const choices = page.getByRole("checkbox", { name: /^选择 （Z2025137）/ });
  await expect(choices).toHaveCount(2);
  await page.getByLabel("实验需求审批日期", { exact: true }).fill("2026-10-14");
  await page.getByRole("button", { name: "查询编号", exact: true }).click();
  await expect(choices).toHaveCount(1);
  await expect(page.getByText("编号内 Z2025137", { exact: true })).toBeVisible();
  await expect(page.getByText("审批 2026-10-14", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "查询编号", exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("number-query.png"), fullPage: true });
  await page.getByRole("button", { name: "清除编号条件", exact: true }).click();
  await expect(choices).toHaveCount(3);
  await page.getByLabel("部分批次编号", { exact: true }).fill("(z2025137）2026022906");
  await page.getByRole("button", { name: "查询编号", exact: true }).click();
  await expect(choices).toHaveCount(1);
  await expect(page.getByText("编号不可解析，保留原值", { exact: true })).toBeVisible();
  const detail = await page.request.get("/api/intake-batches/number-query-2");
  const item = (await detail.json()).item;
  expect(item.batchNo).toBe("（Z2025137）2026022906");
  expect(item.intakeDate).toBe("2026-11-03");
  expect(item).not.toHaveProperty("batchNumberInfo");
});
