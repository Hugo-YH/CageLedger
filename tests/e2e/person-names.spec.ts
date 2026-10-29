import type { Locator, Page } from "@playwright/test";
import { ensureTestInfrastructure, expect, openNavigationEntry, test } from "./fixtures";

async function openFilter(page: Page, label: string): Promise<Locator> {
  await page.getByRole("button", { name: `筛选${label}`, exact: true }).click();
  const filter = page.getByRole("group", { name: `筛选${label}选项`, exact: true });
  await expect(filter).toHaveAttribute("aria-busy", "false");
  return filter;
}

async function applyFilter(filter: Locator) {
  await filter.getByRole("button", { name: "应用", exact: true }).click();
}

test("individual people filters and editing preserve raw intake names", async ({ page }) => {
  const login = await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } });
  expect(login.ok()).toBe(true);
  await page.goto("/app");
  await ensureTestInfrastructure(page);

  const prefix = `PERSON-E2E-${Date.now()}`;
  const supplier = `${prefix}-供应商`;
  const ids: string[] = [];
  const names = ["陈晓卿", "李壮", "陈晓卿；李壮"];
  const owners = ["负责人甲", "负责人乙", "负责人甲\\负责人乙"];
  const batchNos = names.map((_, index) => `${prefix}-${index}`);
  const iacucQuery = "/api/iacuc-index?q=Z2026001&limit=20";
  const indexBeforeResponse = await page.request.get(iacucQuery);
  expect(indexBeforeResponse.ok()).toBe(true);
  const indexBefore = await indexBeforeResponse.json();

  try {
    for (let index = 0; index < names.length; index += 1) {
      const id = `${prefix}-${index}`;
      const response = await page.request.post("/api/intake-batches", {
        data: {
          item: {
            id,
            batchNo: batchNos[index],
            iacuc: "Z2026001",
            supplier,
            pi: names[index],
            owner: owners[index],
            roomName: "8014",
            intakeDate: "2026-10-21",
            quantity: 5,
            finalCardCount: 1,
            species: "mouse",
            status: "pending_print",
            cards: [],
          },
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      ids.push(id);
    }
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    let filter = await openFilter(page, "购买单位");
    await filter.getByRole("checkbox", { name: new RegExp(`${prefix}-供应商`) }).click();
    await applyFilter(filter);
    const rows = page.getByRole("row").filter({ hasText: prefix });
    await expect(rows).toHaveCount(3);
    const compound = rows.filter({ hasText: batchNos[2] });
    await expect(compound).toContainText("陈晓卿、李壮");
    await expect(compound).toContainText("负责人甲、负责人乙");

    filter = await openFilter(page, "项目负责人");
    await expect(filter.getByRole("checkbox", { name: /陈晓卿、李壮|陈晓卿；李壮/ })).toHaveCount(0);
    await filter.getByRole("checkbox", { name: /^陈晓卿\s*\d+$/ }).click();
    await applyFilter(filter);
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: batchNos[1] })).toHaveCount(0);
    filter = await openFilter(page, "项目负责人");
    await filter.getByRole("checkbox", { name: /^李壮\s*\d+$/ }).click();
    await applyFilter(filter);
    await expect(rows).toHaveCount(3);
    filter = await openFilter(page, "项目负责人");
    await filter.getByRole("button", { name: "清空", exact: true }).click();
    await applyFilter(filter);

    filter = await openFilter(page, "实验负责人");
    await expect(filter.getByRole("checkbox", { name: /负责人甲、负责人乙|负责人甲\\负责人乙/ })).toHaveCount(0);
    await filter.getByRole("checkbox", { name: /^负责人甲\s*\d+$/ }).click();
    await applyFilter(filter);
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: batchNos[1] })).toHaveCount(0);
    filter = await openFilter(page, "实验负责人");
    await filter.getByRole("button", { name: "清空", exact: true }).click();
    await applyFilter(filter);
    await expect(rows).toHaveCount(3);

    await compound.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑待接收批次", exact: true });
    const pi = editor.getByLabel("项目负责人", { exact: true });
    await expect(pi).toHaveValue("陈晓卿、李壮");
    await pi.focus();
    await expect(pi).toHaveValue("陈晓卿；李壮");
    await pi.blur();
    await expect(pi).toHaveValue("陈晓卿、李壮");
    const untouched = await page.request.get(`/api/intake-batches/${ids[2]}`);
    expect(((await untouched.json()) as { item: { pi: string } }).item.pi).toBe("陈晓卿；李壮");
    await pi.focus();
    await pi.fill("陈晓卿；李壮；王小明");
    await pi.blur();
    await expect(pi).toHaveValue("陈晓卿、李壮、王小明");
    const saving = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/intake-batches/${ids[2]}` && response.request().method() === "PUT",
    );
    await editor.getByRole("button", { name: "保存待接收批次", exact: true }).click();
    expect((await saving).ok()).toBe(true);
    const saved = await page.request.get(`/api/intake-batches/${ids[2]}`);
    expect(((await saved.json()) as { item: { pi: string; owner: string } }).item).toMatchObject({
      pi: "陈晓卿；李壮；王小明",
      owner: "负责人甲\\负责人乙",
    });
    const audits = await page.request.get("/api/audit-events?limit=100&offset=0");
    expect(audits.ok()).toBe(true);
    const auditItems = (await audits.json()) as {
      items: Array<{ entityId: string; action: string; after?: { truncated?: boolean; entityKeys?: string[] } }>;
    };
    expect(auditItems.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: ids[2],
          action: "intake_batch.updated",
          after: expect.objectContaining({ truncated: true, entityKeys: expect.arrayContaining(["pi"]) }),
        }),
      ]),
    );
    const indexAfter = await page.request.get(iacucQuery);
    expect(indexAfter.ok()).toBe(true);
    expect(await indexAfter.json()).toEqual(indexBefore);
    await editor.getByRole("button", { name: "关闭", exact: true }).click();
    await page.reload();
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    filter = await openFilter(page, "项目负责人");
    await filter.getByRole("checkbox", { name: /^王小明\s*\d+$/ }).click();
    await applyFilter(filter);
    await expect(page.getByRole("row").filter({ hasText: batchNos[2] })).toHaveCount(1);
    await expect(page.getByRole("row").filter({ hasText: batchNos[0] })).toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: batchNos[1] })).toHaveCount(0);
  } finally {
    for (const id of ids) await page.request.delete(`/api/intake-batches/${id}`);
  }
});
