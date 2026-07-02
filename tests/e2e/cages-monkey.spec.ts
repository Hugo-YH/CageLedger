import { expect, test } from "./fixtures";

test.afterEach(async ({ page }) => {
  const response = await page.request.get("/api/bootstrap?scope=room&roomId=room-e2e-monkey");
  if (response.ok()) {
    const data = (await response.json()) as { occupancies?: Array<{ id: string }> };
    for (const occupancy of data.occupancies || []) {
      await page.request.delete(`/api/occupancies/${occupancy.id}`);
    }
  }
  await page.request.delete("/api/rooms/room-e2e-monkey");
});

test("monkey rooms preserve sex, birth date, and calculated age", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();

  await page.request.post("/api/rooms", {
    data: {
      item: {
        id: "room-e2e-monkey",
        name: "E2E 猴房",
        area: "E2E",
        facility: "island",
        defaultSpecies: "monkey",
        defaultBillingItem: "monkey",
        defaultCustomerType: "internal",
        defaultAnimalCount: 1,
      },
    },
  });
  await page.request.post("/api/racks", {
    data: {
      item: { id: "rack-e2e-monkey-1", roomId: "room-e2e-monkey", name: "猴房 01 号笼架", index: 1, rows: 1, cols: 1 },
    },
  });
  await page.request.post("/api/cage-slots", {
    data: { item: { id: "slot-e2e-monkey-a01", rackId: "rack-e2e-monkey-1", row: 1, col: 1, status: "empty" } },
  });
  await page.reload();

  await page.getByRole("button", { name: "笼位管理", exact: true }).click();
  await page.getByRole("combobox", { name: "房间", exact: true }).selectOption({ label: "E2E 猴房" });
  await page.getByRole("button", { name: /E2E 猴房-01-A1/ }).click();
  await expect(page.getByRole("group", { name: "猴个体信息", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "性别", exact: true }).selectOption("female");
  await page.getByLabel("出生日期", { exact: true }).fill("2024-01-15");
  await expect(page.getByLabel("年龄", { exact: true })).not.toHaveValue("自动计算");
  await page.getByRole("button", { name: "保存笼位", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");

  const response = await page.request.get("/api/bootstrap?scope=room&roomId=room-e2e-monkey");
  const data = (await response.json()) as { occupancies: Array<{ animalSex?: string; birthDate?: string }> };
  expect(data.occupancies).toEqual(
    expect.arrayContaining([expect.objectContaining({ animalSex: "female", birthDate: "2024-01-15" })]),
  );
});
