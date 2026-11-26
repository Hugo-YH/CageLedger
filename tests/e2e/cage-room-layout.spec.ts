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
    await create("racks", {
      id,
      roomId,
      name: `测试笼架 ${rack + 1}`,
      index: rack + 1,
      rows: rack === 0 ? 8 : 1,
      cols: rack === 0 ? 11 : 2,
    });
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
  const firstDetail = page.getByRole("region", { name: "测试笼架 1 笼位详情", exact: true });
  const secondDetail = page.getByRole("region", { name: "测试笼架 2 笼位详情", exact: true });
  const closeFirst = firstDetail.getByRole("button", { name: "关闭笼位详情", exact: true });
  const closeSecond = secondDetail.getByRole("button", { name: "关闭笼位详情", exact: true });
  const firstSlot = firstDetail.getByRole("button", { name: new RegExp(`${roomName}-01-A1`) });
  const secondSlot = secondDetail.getByRole("button", { name: new RegExp(`${roomName}-02-A1`) });
  const thirdSlot = secondDetail.getByRole("button", { name: new RegExp(`${roomName}-02-B1`) });
  const toolbar = page.getByRole("group", { name: "笼位图操作", exact: true });
  const workbench = page.locator(".cage-room-workbench");
  const fill = (cell: typeof firstSlot) => cell.evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect(page.getByRole("combobox", { name: "笼架", exact: true })).toHaveCount(0);
  await expect(toolbar.getByRole("combobox")).toHaveCount(0);
  await expect(workbench.locator(".ant-card-head").getByRole("combobox", { name: "房间", exact: true })).toBeVisible();
  const toolbarBox = (await toolbar.boundingBox())!;
  const workbenchBox = (await workbench.boundingBox())!;
  expect(workbenchBox.y - toolbarBox.y - toolbarBox.height).toBeLessThanOrEqual(24);
  await expect(page.getByRole("region", { name: /笼位详情$/ })).toBeHidden();
  await expect(firstRack).toHaveAttribute("aria-pressed", "false");
  await expect(secondRack).toHaveAttribute("aria-pressed", "false");
  const occupiedMiniature = firstRack.locator('.cage-room-rack-preview [data-cage-status="active"]').first();
  await expect(occupiedMiniature).toBeVisible();
  const miniature = (await occupiedMiniature.boundingBox())!;
  expect(miniature.width).toBeGreaterThan(12);
  expect(miniature.height).toBeGreaterThan(6);
  await page.setViewportSize({ width: 1139, height: 790 });
  await page.screenshot({ path: testInfo.outputPath("room-map-overview.png"), animations: "disabled" });

  for (const [width, height] of [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await firstRack.click();
    await expect(firstDetail).toBeVisible();
    await expect(firstRack).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() =>
        firstDetail.evaluate((detail) => {
          const map = document.querySelector('[aria-label="房间笼架布局"]')!;
          const floor = map.getBoundingClientRect();
          const overlay = detail.getBoundingClientRect();
          const left = Math.max(0, floor.left, overlay.left);
          const top = Math.max(0, floor.top, overlay.top);
          const right = Math.min(innerWidth, floor.right, overlay.right);
          const bottom = Math.min(innerHeight, floor.bottom, overlay.bottom);
          if (left >= right || top >= bottom) return false;
          return detail.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
        }),
      )
      .toBe(true);
    await expect(firstSlot).toContainText("Z2026001");
    await expect(firstSlot).toContainText("乙实验员");
    await expect(firstSlot).toContainText(/小鼠.*3/);
    if (height < 500) {
      await page.screenshot({ path: testInfo.outputPath("room-layout-overlay-landscape.png"), animations: "disabled" });
    }
    if (width === 1440) await closeFirst.press("Escape");
    else await closeFirst.click();
    await expect(firstDetail).toBeHidden();
    await expect(firstRack).toBeFocused();
    await expect(firstRack).toHaveAttribute("aria-pressed", "false");
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const floorGeometry = () =>
    map.evaluate((region) => {
      const board = region.querySelector(".cage-room-map")!;
      const floor = board.getBoundingClientRect();
      return {
        width: floor.width,
        racks: Array.from(board.querySelectorAll(".cage-room-rack"), (rack) => {
          const footprint = rack.getBoundingClientRect();
          return [(footprint.left - floor.left) / floor.width, (footprint.top - floor.top) / floor.height];
        }),
      };
    });
  const readLayout = async () => {
    const response = await page.request.get(`${roomPath}?view=cages`);
    expect(response.ok()).toBe(true);
    return ((await response.json()) as RoomWorkspace).rackLayout;
  };
  const beforeZoom = await floorGeometry();
  const savedBeforeZoom = await readLayout();
  await page.getByRole("button", { name: "放大房间图", exact: true }).click();
  await expect.poll(async () => (await floorGeometry()).width).toBeGreaterThan(beforeZoom.width);
  const enlarged = await floorGeometry();
  expect(enlarged.racks).toHaveLength(beforeZoom.racks.length);
  for (const [index, [column, row]] of enlarged.racks.entries()) {
    expect(column).toBeCloseTo(beforeZoom.racks[index][0], 3);
    expect(row).toBeCloseTo(beforeZoom.racks[index][1], 3);
  }
  await page.getByRole("button", { name: "缩小房间图", exact: true }).click();
  await expect.poll(async () => Math.abs((await floorGeometry()).width - beforeZoom.width)).toBeLessThan(1);
  expect(await readLayout()).toEqual(savedBeforeZoom);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await firstRack.click();
    const firstColor = await fill(firstSlot);
    await closeFirst.click();
    await secondRack.click();
    await expect(secondRack).toHaveAttribute("aria-pressed", "true");
    await expect(secondSlot).toHaveAttribute("data-cage-status", "overdue");
    await expect(secondSlot).toHaveCSS("border-top-style", "solid");
    expect(await fill(secondSlot)).toBe(firstColor);
    expect(await fill(thirdSlot)).not.toBe(firstColor);
    await captureUiAudit(page, testInfo, `room-layout-${theme}`, page.locator(".cage-room-workbench"));
    await closeSecond.click();
  }

  await firstRack.click();
  await closeFirst.click();
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
  const editedLayout = (await readLayout())!;
  expect(editedLayout.placements).toContainEqual({ rackId: rackIds[0], column: 2, row: 1, rotation: 90 });
  await page.reload();
  await chooseRoom(page);
  await expect(firstRack).toHaveAttribute("data-rotation", "90");
  await expect(secondRack).toBeVisible();
  await expect(page.getByRole("region", { name: /笼位详情$/ })).toBeHidden();

  const verticalPlacements = [
    { rackId: rackIds[0], column: 3, row: 2, rotation: 0 },
    { rackId: rackIds[1], column: 3, row: 5, rotation: 0 },
  ];
  const response = await page.request.put(`${roomPath}/rack-layout`, {
    data: { placements: verticalPlacements, expectedUpdatedAt: editedLayout.updatedAt },
  });
  expect(response.ok()).toBe(true);
  const verticalLayout = (await response.json()) as NonNullable<RoomWorkspace["rackLayout"]>;
  expect(verticalLayout.placements).toEqual(verticalPlacements);
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await chooseRoom(page);
  await expect(firstRack).toBeInViewport();
  await expect(secondRack).toBeInViewport();
  const upperRack = (await firstRack.boundingBox())!;
  const lowerRack = (await secondRack.boundingBox())!;
  expect(Math.abs(upperRack.x - lowerRack.x)).toBeLessThan(1);
  expect(lowerRack.y).toBeGreaterThanOrEqual(upperRack.y + upperRack.height - 1);
  const frame = await map.evaluate((region) => {
    const outer = region.getBoundingClientRect();
    const floor = region.querySelector(".cage-room-map")!.getBoundingClientRect();
    const card = region.closest(".cage-room-panel")!.getBoundingClientRect();
    return {
      frameWidth: outer.width,
      floorWidth: floor.width,
      cardWidth: card.width,
      centerOffset: outer.left + outer.width / 2 - (card.left + card.width / 2),
    };
  });
  expect(Math.abs(frame.frameWidth - frame.floorWidth)).toBeLessThanOrEqual(18);
  expect(frame.frameWidth).toBeLessThan(frame.cardWidth * 0.85);
  expect(Math.abs(frame.centerOffset)).toBeLessThanOrEqual(2);
  expect(await readLayout()).toEqual(verticalLayout);
  await page.screenshot({ path: testInfo.outputPath("room-map-vertical.png"), animations: "disabled" });
});
