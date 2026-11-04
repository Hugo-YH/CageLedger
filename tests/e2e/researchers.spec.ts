import { execFileSync } from "node:child_process";
import { expect, openSettingsView, test } from "./fixtures";

function spreadsheet(rows: Array<Array<string | null>>) {
  return execFileSync(
    process.execPath,
    [
      "scripts/run_python.mjs",
      "-c",
      [
        "import json,sys,re",
        "from io import BytesIO",
        "from zipfile import ZipFile",
        "from openpyxl import Workbook",
        "w=Workbook();s=w.active;s.title='成员列表'",
        "s.append(['导出通讯录说明']);s.append(['姓名','账号','手机','邮箱','部门'])",
        "for row in json.load(sys.stdin): s.append(row)",
        "b=BytesIO();w.save(b);w.close();o=BytesIO()",
        "with ZipFile(BytesIO(b.getvalue())) as source, ZipFile(o,'w') as target:",
        " for item in source.infolist():",
        "  data=source.read(item.filename)",
        "  if item.filename=='xl/worksheets/sheet1.xml': data=re.sub(rb'<dimension ref=\"[^\"]+\"',b'<dimension ref=\"A1\"',data)",
        "  target.writestr(item,data)",
        "sys.stdout.buffer.write(o.getvalue())",
      ].join("\n"),
    ],
    { input: JSON.stringify(rows) },
  );
}

test("researcher preview, import retry, stable IDs, contact editing and responsive layouts work together", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const health = await (await page.request.get("/api/health")).json();
  expect(health.database).toContain("cageledger-e2e-");
  expect((await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } })).ok()).toBe(
    true,
  );
  const usersBefore = (await (await page.request.get("/api/users")).json()).users.length;
  await page.goto("/app");
  await openSettingsView(page, "实验人员信息");
  await expect(page.getByRole("heading", { name: "实验人员信息", exact: true })).toBeVisible();
  const content = spreadsheet([
    ["同名测试", "researcher-alpha", "13900000001", "alpha@example.org", "实验人员/课题组A"],
    ["同名测试", "researcher-beta", "13900000001", "beta@example.org", "实验人员/课题组B"],
    ["第三位", "researcher-gamma", null, null, "实验人员/课题组A"],
  ]);
  await page.getByRole("button", { name: "导入 Excel", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入实验人员信息", exact: true });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "通讯录.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: content,
  });
  await expect(dialog.getByText("新增 3", { exact: true })).toBeVisible();
  expect((await (await page.request.get("/api/researchers")).json()).page.total).toBe(0);
  await dialog
    .getByRole("button", { name: /展开行/ })
    .first()
    .click();
  await expect(dialog.getByText(/手机：.*13900000001/)).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [1180, 820],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(dialog.getByRole("button", { name: "确认导入", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`researcher-import-${width}.png`), animations: "disabled" });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const requests: Array<{ requestId: string }> = [];
  await page.route("**/api/researchers/import", async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) await route.fulfill({ status: 503, json: { error: "测试连接中断" } });
    else await route.continue();
  });
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(dialog.getByText(/测试连接中断/)).toBeVisible();
  await expect(dialog.getByText("新增 3", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests[0].requestId).toBe(requests[1].requestId);
  const notice = page.getByRole("status").filter({ hasText: "实验人员信息已导入" });
  await expect(notice).toContainText("新增 3 人");
  await notice.getByRole("button", { name: "关闭通知", exact: true }).click();
  const people = (await (await page.request.get("/api/researchers")).json()).items;
  expect(people).toHaveLength(3);
  expect(new Set(people.map((person: { id: string }) => person.id)).size).toBe(3);
  expect((await (await page.request.get("/api/users")).json()).users.length).toBe(usersBefore);
  const search = page
    .getByRole("searchbox", { name: "搜索实验人员" })
    .or(page.getByRole("textbox", { name: "搜索实验人员" }));
  await search.fill("同名测试");
  await search.press("Enter");
  await expect(page.locator("tr[data-row-key]")).toHaveCount(2);
  await search.fill("");
  await expect(page.locator("tr[data-row-key]")).toHaveCount(3);
  for (const [width, height] of [
    [1440, 900],
    [1180, 820],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`researchers-list-${width}.png`), animations: "disabled" });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "更多", exact: true }).click();
  await page.locator(".ant-mobile-navigation-sheet .adm-list-item").filter({ hasText: "实验人员信息" }).click();
  await expect(page.getByRole("heading", { name: "实验人员信息", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  const alpha = people.find((person: { account: string }) => person.account === "researcher-alpha");
  await page
    .locator(`tr[data-row-key="${alpha.id}"]`)
    .getByRole("button", { name: "查看 / 编辑", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "编辑实验人员资料", exact: true });
  await editor.getByRole("textbox", { name: "手机", exact: true }).fill("13900000009");
  const external = await page.request.put(`/api/researchers/${alpha.id}`, {
    data: { item: { position: "另一次修改" }, expectedUpdatedAt: alpha.updatedAt },
  });
  expect(external.ok(), await external.text()).toBe(true);
  await editor.getByRole("button", { name: "保存资料", exact: true }).click();
  await expect(editor.getByText("资料已被其他人更新，当前草稿已保留", { exact: true })).toBeVisible();
  await expect(editor.getByRole("textbox", { name: "手机", exact: true })).toHaveValue("13900000009");
  await editor.getByRole("button", { name: "加载最新资料核对", exact: true }).click();
  await editor.getByRole("button", { name: "放弃当前草稿，按最新资料重新编辑", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "职务", exact: true })).toHaveValue("另一次修改");
  await editor.getByRole("textbox", { name: "手机", exact: true }).fill("13900000009");
  await editor.getByRole("button", { name: "保存资料", exact: true }).click();
  await expect(editor).toBeHidden();
  const saved = (await (await page.request.get(`/api/researchers/${alpha.id}`)).json()).item;
  expect(saved).toMatchObject({
    id: alpha.id,
    account: "researcher-alpha",
    mobile: "13900000009",
    position: "另一次修改",
  });
  const audits = (await (await page.request.get("/api/audit-events?limit=100&offset=0")).json()).items;
  expect(audits.some((event: { action: string }) => event.action === "researcher_directory.imported")).toBe(true);
  expect(audits.some((event: { action: string }) => event.action === "researcher.updated")).toBe(true);
});

test("researcher contacts are readable by room administrators while import and edits remain admin-only", async ({
  page,
  playwright,
}) => {
  const health = await (await page.request.get("/api/health")).json();
  expect(health.database).toContain("cageledger-e2e-");
  await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } });
  const user = `researcher-reader-${Date.now()}`;
  const create = await page.request.post("/api/users", {
    data: {
      username: user,
      password: "researcher-reader-password",
      displayName: "实验人员目录查询员",
      role: "room_admin",
      roomIds: [],
    },
  });
  expect(create.ok(), await create.text()).toBe(true);
  const file = {
    filename: "只读测试.xlsx",
    data: spreadsheet([["只读目录样例", user, "13900000008", null, "部门"]]).toString("base64"),
  };
  const preview = await page.request.post("/api/researchers/import/preview", { data: file });
  const confirmed = await page.request.post("/api/researchers/import", {
    data: { ...file, confirmationToken: (await preview.json()).confirmationToken, requestId: user },
  });
  expect(confirmed.ok(), await confirmed.text()).toBe(true);
  const person = (await (await page.request.get(`/api/researchers?q=${user}`)).json()).items[0];
  await page.request.post("/api/auth/login", { data: { username: user, password: "researcher-reader-password" } });
  for (const path of ["/api/researchers/import/preview", "/api/researchers/import"])
    expect((await page.request.post(path, { data: {} })).status()).toBe(403);
  expect((await page.request.put(`/api/researchers/${person.id}`, { data: {} })).status()).toBe(403);
  expect((await page.request.get(`/api/researchers/${person.id}`)).ok()).toBe(true);
  await page.goto("/app");
  await openSettingsView(page, "实验人员信息");
  await expect(page.getByRole("button", { name: "导入 Excel", exact: true })).toHaveCount(0);
  await page.locator(`tr[data-row-key="${person.id}"]`).getByRole("button", { name: "查看", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "实验人员资料", exact: true });
  await expect(detail.getByText("13900000008", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "保存资料", exact: true })).toHaveCount(0);
  const anonymous = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    expect((await anonymous.get("/api/researchers")).status()).toBe(401);
    expect((await anonymous.post("/api/researchers/import/preview", { data: {} })).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
});

test("researcher list keeps its card, filters, pagination and fixed actions inside four viewport sizes", async ({
  page,
}, info) => {
  const health = await (await page.request.get("/api/health")).json();
  expect(health.database).toContain("cageledger-e2e-");
  await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } });
  const file = {
    filename: "布局测试.xlsx",
    data: spreadsheet([
      ["布局测试人员", "layout-researcher", "13900000007", "layout@example.org", "实验人员/部门/较长课题组名称"],
    ]).toString("base64"),
  };
  const preview = await page.request.post("/api/researchers/import/preview", { data: file });
  const imported = await page.request.post("/api/researchers/import", {
    data: { ...file, confirmationToken: (await preview.json()).confirmationToken, requestId: "layout-researcher" },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
  await page.goto("/app");
  await openSettingsView(page, "实验人员信息");
  const card = page.locator(".researchers-list-card");
  for (const [width, height] of [
    [1440, 900],
    [1180, 820],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(card).toBeVisible();
    const right = async () => (await card.boundingBox())!.x + (await card.boundingBox())!.width;
    await expect.poll(right).toBeLessThanOrEqual(width);
    const filters = card.locator(".ant-input-search");
    await expect
      .poll(async () => (await filters.boundingBox())!.x + (await filters.boundingBox())!.width)
      .toBeLessThanOrEqual(await right());
    const pagination = card.locator(".ant-pagination");
    await expect
      .poll(async () => (await pagination.boundingBox())!.x + (await pagination.boundingBox())!.width)
      .toBeLessThanOrEqual(await right());
    const edit = card.getByRole("button", { name: "查看 / 编辑", exact: true }).first();
    await expect
      .poll(async () => (await edit.boundingBox())!.x + (await edit.boundingBox())!.width)
      .toBeLessThanOrEqual(await right());
    const table = card.locator(".ant-table-content");
    expect(await table.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    await table.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
    expect(await table.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await expect
      .poll(async () => (await edit.boundingBox())!.x + (await edit.boundingBox())!.width)
      .toBeLessThanOrEqual(await right());
    await table.evaluate((node) => {
      node.scrollLeft = 0;
    });
    await info.attach(`researcher-layout-${width}`, {
      body: JSON.stringify(
        await card.evaluate((node) => ({
          card: node.getBoundingClientRect().toJSON(),
          minWidth: getComputedStyle(node).minWidth,
          tableOverflow: getComputedStyle(node.querySelector(".ant-table-content")!).overflowX,
        })),
      ),
      contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath(`researcher-contained-${width}.png`), animations: "disabled" });
  }
});
