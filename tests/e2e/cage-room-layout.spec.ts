import type { Page } from "@playwright/test";
import type { RoomWorkspace } from "../../src/contracts/infrastructure";
import { expect, test } from "./fixtures";
import { captureUiAudit } from "./uiAudit";

const roomId = "room-e2e-rack-layout";
const roomName = "E2E 布局房间";
const roomPath = `/api/infrastructure/rooms/${roomId}`;
const rackIds = ["rack-layout-a", "rack-layout-b"];
const occupiedSlots = [
  { rack: 0, col: 1, iacuc: "Z2026001", endDate: "2099-01-01" },
  { rack: 1, col: 1, iacuc: "z2026001", endDate: "2020-01-01" },
  { rack: 1, col: 2, iacuc: "Z2026002", endDate: "2099-01-01" },
];

async function chooseRoom(page: Page) {
  await page.getByRole("combobox", { name: "房间", exact: true }).click();
  await page.locator(".ant-select-dropdown").filter({ visible: true }).getByText(roomName, { exact: true }).click();
}

test.afterEach(async ({ page }) => {
  for (const { rack, col } of occupiedSlots) await page.request.delete(`/api/occupancies/rack-layout-${rack}-${col}`);
  await page.request.delete(`/api/rooms/${roomId}`);
});

test("room map keeps project colors across racks and saves the edited floor plan", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  const create = async (path: string, item: object) => {
    const response = await page.request.post(`/api/${path}`, { data: { item } });
    expect(response.ok(), await response.text()).toBe(true);
  };
  await create("rooms", { id: roomId, name: roomName, defaultSpecies: "mouse" });
  for (const [rack, id] of rackIds.entries()) {
    await create("racks", { id, roomId, name: `测试笼架 ${rack + 1}`, index: rack + 1, rows: 1, cols: 2 });
  }
  for (const { rack, col, iacuc, endDate } of occupiedSlots) {
    const id = `rack-layout-${rack}-${col}`;
    await create("cage-slots", { id, rackId: rackIds[rack], row: 1, col, status: "empty" });
    await create("occupancies", {
      id,
      slotId: id,
      status: "active",
      iacuc,
      pi: "甲负责人",
      owner: "乙实验员",
      animalCount: 3,
      startDate: "2000-01-01",
      endDate,
      cageCode: `${roomName}-0${rack + 1}-${col === 1 ? "A1" : "B1"}`,
    });
  }
  await page.reload();
  await page.getByRole("menuitem", { name: /笼位管理/ }).click();
  await chooseRoom(page);
  const map = page.getByRole("region", { name: "房间笼架布局" });
  const firstRack = map.getByRole("button", { name: /^测试笼架 1/ });
  const secondRack = map.getByRole("button", { name: /^测试笼架 2/ });
  const firstSlot = page.getByRole("button", { name: new RegExp(`${roomName}-01-A1`) });
  const secondSlot = page.getByRole("button", { name: new RegExp(`${roomName}-02-A1`) });
  const thirdSlot = page.getByRole("button", { name: new RegExp(`${roomName}-02-B1`) });
  const fill = (cell: typeof firstSlot) => cell.evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect(firstRack).toHaveAttribute("aria-pressed", "true");
  await expect(firstSlot).toContainText("Z2026001");
  await expect(firstSlot).toContainText("乙实验员");
  await expect(firstSlot).toContainText(/小鼠.*3/);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await firstRack.click();
    const firstColor = await fill(firstSlot);
    await secondRack.click();
    await expect(secondRack).toHaveAttribute("aria-pressed", "true");
    await expect(secondSlot).toHaveAttribute("data-cage-status", "overdue");
    await expect(secondSlot).toHaveCSS("border-top-style", "solid");
    expect(await fill(secondSlot)).toBe(firstColor);
    expect(await fill(thirdSlot)).not.toBe(firstColor);
    await captureUiAudit(page, testInfo, `room-layout-${theme}`, page.locator(".cage-room-workbench"));
  }

  await firstRack.click();
  const edit = page.getByRole("button", { name: "编辑布局" });
  await edit.click();
  const dialog = page.getByRole("dialog", { name: "编辑笼架布局" });
  const editedRack = dialog.getByRole("button", { name: /^测试笼架 1/ });
  const position = dialog.getByRole("status");
  await expect(position).toHaveText(/第 2 列 · 第 2 行 · 0°/);
  const moveRight = dialog.getByRole("button", { name: "右移一格" });
  await moveRight.click();
  await moveRight.click();
  await moveRight.click();
  await expect(dialog.getByText(/与其他笼架重叠/)).toBeVisible();
  await expect(position).toHaveText(/第 4 列 · 第 2 行 · 0°/);

  const footprint = (await editedRack.boundingBox())!;
  const x = footprint.x + footprint.width / 2;
  const y = footprint.y + footprint.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - footprint.width / 4, y, { steps: 4 });
  await page.mouse.up();
  await expect(position).toHaveText(/第 3 列 · 第 2 行 · 0°/);
  await dialog.getByRole("button", { name: "旋转 90°" }).click();
  await expect(position).toHaveText(/第 3 列 · 第 2 行 · 90°/);
  await dialog.getByRole("button", { name: "保存布局" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  const saved = (await (await page.request.get(`${roomPath}?view=cages`)).json()) as RoomWorkspace;
  expect(saved.rackLayout?.placements).toContainEqual({ rackId: rackIds[0], column: 2, row: 1, rotation: 90 });
  await page.reload();
  await chooseRoom(page);
  await expect(firstRack).toHaveAttribute("data-rotation", "90");
  await expect(secondRack).toBeVisible();
});
