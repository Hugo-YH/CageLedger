import type { Route } from "@playwright/test";
import { expect, openSettingsView, selectAntOptionByKeyboard, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
});

test("identity edits own their pending and error state without resetting other drafts", async ({ page }) => {
  const items = ["甲", "乙"].map((pi) => ({ pi, principalType: "independent", freeCageAllowance: 10, updatedAt: "1" }));
  await page.route("**/api/principal-identities", (route) => route.fulfill({ json: { items } }));
  let pending: Route | undefined;
  let writes = 0;
  await page.route("**/api/principal-identities/*", (route) => {
    writes += 1;
    pending = route;
  });
  await openSettingsView(page, "数据管理");
  const first = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "甲", exact: true }) });
  const second = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "乙", exact: true }) });
  await selectAntOptionByKeyboard(page, first.getByRole("combobox"));
  const save = first.getByRole("button", { name: "保存 甲 的负责人身份" });
  await save.click();
  await expect.poll(() => writes).toBe(1);
  await expect(save).toBeDisabled();
  await expect(save).toHaveClass(/ant-btn-loading/);
  await expect(second.getByRole("button")).not.toHaveClass(/ant-btn-loading/);
  await selectAntOptionByKeyboard(page, second.getByRole("combobox"));
  await pending?.fulfill({ status: 409, json: { error: "身份记录已更新，请重试" } });
  await expect(first.getByRole("alert")).toContainText("身份记录已更新，请重试");
  await expect(first.getByText("PI", { exact: true }).first()).toBeVisible();
  await save.click();
  await expect.poll(() => writes).toBe(2);
  items[0] = { ...items[0], principalType: "pi", freeCageAllowance: 20, updatedAt: "2" };
  await pending?.fulfill({ json: { item: items[0] } });
  await expect(first.getByRole("alert")).toHaveCount(0);
  await expect(first.getByRole("cell", { name: "20", exact: true })).toBeVisible();
  await expect(second.getByText("PI", { exact: true }).first()).toBeVisible();
});

test("index errors offer retry and imports stay single-flight through the refresh", async ({ page }) => {
  let statusReads = 0;
  let refresh: Route | undefined;
  await page.route("**/api/iacuc-index/status", (route) => {
    statusReads += 1;
    if (statusReads === 1) return route.fulfill({ status: 403, json: { error: "索引暂不可读" } });
    if (statusReads === 2) return route.fulfill({ json: { count: 3 } });
    refresh = route;
  });
  let pending: Route | undefined;
  let writes = 0;
  await page.route("**/api/iacuc-index/upload", (route) => {
    writes += 1;
    pending = route;
  });
  await openSettingsView(page, "数据管理");
  const index = page.locator(".ant-card").filter({ has: page.getByText("IACUC 索引", { exact: true }) });
  await expect(index.getByText("索引状态加载失败", { exact: true })).toBeVisible();
  await expect(index.getByText("尚未上传索引")).toHaveCount(0);
  await index.getByRole("button", { name: "重新加载" }).click();
  await expect(index.getByText("已索引记录", { exact: true })).toBeVisible();
  const file = { name: "test.csv", mimeType: "text/csv", buffer: Buffer.from("iacuc\nTEST") };
  const inputs = page.locator('.data-import-dragger input[type="file"]');
  await inputs.first().setInputFiles(file);
  await expect.poll(() => writes).toBe(1);
  for (const input of await inputs.all()) await expect(input).toBeDisabled();
  await pending?.fulfill({ status: 400, json: { error: "CSV 格式不正确" } });
  await expect(page.getByRole("alert")).toContainText("CSV 格式不正确");
  await expect(inputs.first()).toBeEnabled();
  await inputs.first().setInputFiles(file);
  await expect.poll(() => writes).toBe(2);
  await pending?.fulfill({ json: { count: 4 } });
  await expect.poll(() => statusReads).toBe(3);
  for (const input of await inputs.all()) await expect(input).toBeDisabled();
  await refresh?.fulfill({ json: { count: 4 } });
  await expect(page.getByRole("status")).toContainText("共 4 条记录");
  for (const input of await inputs.all()) await expect(input).toBeEnabled();
});
