import { ensureTestInfrastructure, expect, openNavigationEntry, test } from "./fixtures";

test("intake keeps header number filters and legacy query compatibility without a separate number form", async ({
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
  await expect(page.getByRole("region", { name: "待接收批次列表" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /订单编号/ })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "批次编号全库查询", exact: true })).toHaveCount(0);
  for (const label of ["部分批次编号", "编号内 IACUC", "实验需求审批日期", "批次序号"])
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  for (const name of ["查询编号", "清除编号条件"])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(page.getByText("查询全部批次；多个条件同时满足。", { exact: false })).toHaveCount(0);

  const choices = page.getByRole("checkbox", { name: /^选择 （Z2025137）/ });
  await expect(choices).toHaveCount(3);
  for (const text of ["编号内 Z2025137", "审批 2026-10-14", "审批 2026-10-15", "第 06 批", "编号不可解析，保留原值"])
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "筛选批次号", exact: true }).click();
  const filter = page.getByRole("group", { name: "筛选批次号选项", exact: true });
  const parsedNumber = "（Z2025137）2026101406";
  const parsedOption = filter.getByRole("checkbox", { name: parsedNumber, exact: false });
  await parsedOption.click();
  await expect(parsedOption).toBeChecked();
  await filter.getByRole("button", { name: "应用", exact: true }).click();
  await expect(choices).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: `选择 ${parsedNumber}`, exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: parsedNumber, exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "2026-11-03", exact: true })).toBeVisible();
  await expect(filter).not.toBeVisible();
  await page.screenshot({ path: info.outputPath("number-query.png"), fullPage: true });

  await page.getByRole("button", { name: "筛选批次号", exact: true }).click();
  await parsedOption.click();
  await expect(parsedOption).not.toBeChecked();
  const invalidNumber = "（Z2025137）2026022906";
  const invalidOption = filter.getByRole("checkbox", { name: invalidNumber, exact: false });
  await invalidOption.click();
  await expect(invalidOption).toBeChecked();
  await filter.getByRole("button", { name: "应用", exact: true }).click();
  await expect(choices).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: `选择 ${invalidNumber}`, exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: invalidNumber, exact: true })).toBeVisible();

  const numberFilters = { batchNumberIacuc: ["z2025137"], batchSequence: ["6"] };
  for (const [columnFilters, expectedIds] of [
    [numberFilters, ["number-query-0", "number-query-1"]],
    [{ ...numberFilters, batchApprovalDate: ["2026-10-14"] }, ["number-query-0"]],
    [{ batchNumberSearch: ["(z2025137）2026022906"] }, ["number-query-2"]],
  ] as const) {
    const response = await page.request.get("/api/intake-batches", {
      params: { view: "summary", columnFilters: JSON.stringify(columnFilters) },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const result = (await response.json()) as {
      items: {
        id: string;
        intakeDate: string;
        batchNumberInfo: {
          status: "parsed" | "unparseable";
          iacuc: string | null;
          approvalDate: string | null;
          sequence: string | null;
        };
      }[];
      page: { total: number };
    };
    expect(result.page.total).toBe(expectedIds.length);
    expect(result.items.map((item) => item.id).sort()).toEqual([...expectedIds].sort());
    for (const item of result.items) {
      expect(item.intakeDate).toBe("2026-11-03");
      expect(item.batchNumberInfo).toEqual(
        item.id === "number-query-2"
          ? { status: "unparseable", iacuc: null, approvalDate: null, sequence: null }
          : {
              status: "parsed",
              iacuc: "Z2025137",
              approvalDate: item.id === "number-query-0" ? "2026-10-14" : "2026-10-15",
              sequence: "06",
            },
      );
    }
  }
  const detail = await page.request.get("/api/intake-batches/number-query-2");
  const item = (await detail.json()).item;
  expect(item.batchNo).toBe("（Z2025137）2026022906");
  expect(item.intakeDate).toBe("2026-11-03");
  expect(item).not.toHaveProperty("batchNumberInfo");
});
