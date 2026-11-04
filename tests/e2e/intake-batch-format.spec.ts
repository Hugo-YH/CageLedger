import { ensureTestInfrastructure, expect, openNavigationEntry, test } from "./fixtures";

const legacyNumbers = ["(Z2025117)2026050808", "(Z2026026)2026042806"];
const displayNumbers = ["（Z2025117）2026050808", "（Z2026026）2026042806"];

test("batch filter displays Chinese brackets for legacy options while retaining working lookup values", async ({
  page,
}, info) => {
  const health = await page.request.get("/api/health");
  expect((await health.json()).database).toContain("cageledger-e2e-");
  const login = await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } });
  expect(login.ok()).toBe(true);
  await page.goto("/app");
  await ensureTestInfrastructure(page);
  const createdIds: string[] = [];
  try {
    for (const [index, batchNo] of legacyNumbers.entries()) {
      const response = await page.request.post("/api/intake-batches", {
        data: {
          item: {
            species: "mouse",
            status: "pending_print",
            cards: [],
            receipts: [],
            rawMessage: "测试预约原文",
            id: `batch-format-${index}`,
            batchNo,
            iacuc: index ? "Z2026026" : "Z2025117",
            supplier: "测试供应商",
            pi: "测试负责人",
            owner: "测试实验负责人",
            roomName: "8014",
            intakeDate: "2026-11-03",
            finalCardCount: 1,
            quantity: 6,
          },
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      createdIds.push(`batch-format-${index}`);
    }
    // Simulate a cached/legacy response: display must not depend on label formatting
    // or replace the original lookup value sent when applying the filter.
    await page.route("**/api/filter-options?**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("list") !== "intake-batches" || url.searchParams.get("column") !== "batchNo")
        return route.continue();
      const response = await route.fetch();
      const body = (await response.json()) as { items: { value: string; label: string; count: number }[] };
      body.items = body.items.map((option) =>
        legacyNumbers.includes(option.value) ? { ...option, label: option.value } : option,
      );
      await route.fulfill({ response, json: body });
    });
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    await page.getByRole("button", { name: "筛选批次号", exact: true }).click();
    const filter = page.getByRole("group", { name: "筛选批次号选项", exact: true });
    for (const number of displayNumbers)
      await expect(filter.getByRole("checkbox", { name: number, exact: false })).toBeVisible();
    for (const number of legacyNumbers) await expect(filter.getByText(number, { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("batch-filter-chinese-brackets.png"), animations: "disabled" });
    const checkbox = filter.getByRole("checkbox", { name: displayNumbers[0], exact: false });
    // Checkbox.Group commits its controlled value in an effect. Click once, then
    // assert the committed state instead of check()'s immediate post-click read.
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    const applied = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/intake-batches" &&
        (url.searchParams.get("columnFilters") || "").includes(legacyNumbers[0])
      );
    });
    await filter.getByRole("button", { name: "应用", exact: true }).click();
    const result = await applied;
    expect(result.ok(), await result.text()).toBe(true);
    expect((await result.json()).items.map((item: { batchNo: string }) => item.batchNo)).toEqual([displayNumbers[0]]);
    await expect(page.getByRole("row").filter({ hasText: displayNumbers[0] })).toHaveCount(1);
    await expect(page.getByRole("row").filter({ hasText: displayNumbers[1] })).toHaveCount(0);
  } finally {
    for (const id of createdIds)
      expect((await page.request.delete(`/api/intake-batches/${encodeURIComponent(id)}`)).ok()).toBe(true);
  }
});
