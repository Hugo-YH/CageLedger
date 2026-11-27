import type { RoomWorkspace } from "../../src/contracts/infrastructure";
import { chooseCageRoom, expect, selectAntOptionByKeyboard, test } from "./fixtures";
import { captureUiAudit } from "./uiAudit";

const roomId = "room-e2e-rack-layout";
const roomName = "E2E 布局房间";
const roomPath = `/api/infrastructure/rooms/${roomId}`;
const rackIds = ["rack-layout-a", "rack-layout-b"];
const occupiedSlots = [
  { rack: 0, col: 1, iacuc: "Z2026001", endDate: "2099-01-01" },
  { rack: 1, col: 1, iacuc: "z2026001", endDate: "2020-01-01" },
  { rack: 1, col: 2, iacuc: "Z2026002", endDate: "" },
];

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
      rows: rack === 0 ? 8 : 2,
      cols: rack === 0 ? 11 : 6,
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
      ...(rack === 0 ? { species: "C57小鼠 460只； 6种基因工程小鼠 560只" } : {}),
      ...(iacuc === "Z2026002" ? { strainStandard: "C57BL/6J" } : {}),
      ...(rack === 1 && col === 1 ? { species: "恒河猴12只", animalSex: "female", birthDate: "2020-01-01" } : {}),
      ...(endDate ? { animalCount: 3 } : {}),
      startDate: "2000-01-01",
      endDate,
      cageCode: `${roomName}-0${rack + 1}-${col === 1 ? "A1" : "B1"}`,
    });
  }
  await page.reload();
  await page.getByRole("menuitem", { name: /笼位管理/ }).click();
  const workbench = page.locator(".cage-room-workbench");
  const header = workbench.locator(".ant-card-head");
  const empty = workbench.getByText("请选择饲养间查看笼架", { exact: true });
  await expect(empty).toBeVisible();
  await expect(header.locator(".cage-facility-select").getByTitle("全部设施", { exact: true })).toBeVisible();
  await header.getByRole("combobox", { name: "设施", exact: true }).click();
  await page
    .locator(".ant-select-dropdown")
    .filter({ visible: true })
    .getByText("珠江新城设施", { exact: true })
    .click();
  await expect(header.locator(".cage-facility-select").getByTitle("珠江新城设施", { exact: true })).toBeVisible();
  await expect(empty).toBeVisible();
  const map = page.getByRole("region", { name: "房间笼架布局" });
  await expect(map).toHaveCount(0);
  await chooseCageRoom(page, roomName);
  const firstRack = map.getByRole("button", { name: /^测试笼架 1/ });
  const secondRack = map.getByRole("button", { name: /^测试笼架 2/ });
  const zoom = page.getByRole("button", { name: "恢复房间图比例", exact: true });
  const zoomIn = page.getByRole("button", { name: "放大房间图", exact: true });
  const zoomControls = page.getByRole("group", { name: "房间图缩放", exact: true });
  const zoomControlPosition = () =>
    zoomControls.evaluate((controls) => {
      const frame = controls.parentElement!.getBoundingClientRect();
      const bounds = controls.getBoundingClientRect();
      return [bounds.left - frame.left, bounds.top - frame.top, frame.right - bounds.right];
    });
  const firstSlot = map.getByRole("button", { name: new RegExp(`${roomName}-01-A1`) });
  const secondSlot = map.getByRole("button", { name: new RegExp(`${roomName}-02-A1`) });
  const thirdSlot = map.getByRole("button", { name: new RegExp(`${roomName}-02-B1`) });
  const toolbar = page.getByRole("group", { name: "笼位图操作", exact: true });
  await expect(workbench.getByText("IACUC 底色", { exact: true })).toHaveCount(0);
  await expect(workbench.locator(".cage-map-key").getByText("未填结束日期", { exact: true })).toBeVisible();
  const fill = (cell: typeof firstSlot) => cell.evaluate((element) => getComputedStyle(element).backgroundColor);
  const expectSquare = async (cell: typeof firstSlot) => {
    const bounds = (await cell.boundingBox())!;
    expect(bounds.width).toBeCloseTo(bounds.height, 0);
  };
  await expect(page.getByRole("combobox", { name: "笼架", exact: true })).toHaveCount(0);
  await expect(toolbar.getByRole("combobox")).toHaveCount(0);
  await expect(header.locator(".cage-room-select").getByTitle(roomName, { exact: true })).toBeVisible();
  await expect(header.getByRole("heading", { name: "饲养间", exact: true })).toBeVisible();
  await expect(header.getByRole("combobox", { name: "房间", exact: true })).toBeVisible();
  await expect(header.getByText("2 个笼架", { exact: true })).toBeVisible();
  const help = header.getByRole("button", { name: "房间图操作说明", exact: true });
  await help.press("Enter");
  await expect(page.getByText("点击笼架查看详情。", { exact: true })).toBeVisible();
  await help.press("Escape");
  await expect(help).toHaveAttribute("aria-expanded", "false");
  const toolbarBox = (await toolbar.boundingBox())!;
  const workbenchBox = (await workbench.boundingBox())!;
  expect(workbenchBox.y - toolbarBox.y - toolbarBox.height).toBeLessThanOrEqual(24);
  await expect(page.getByRole("region", { name: /笼位详情$/ })).toBeHidden();
  await expect(firstRack).toHaveAttribute("aria-pressed", "false");
  await expect(secondRack).toHaveAttribute("aria-pressed", "false");
  await expect(map.getByText(/^\d+ 空$/)).toHaveCount(0);
  await expect(map.getByText(/Z202600[12]/)).toHaveCount(0);
  const occupiedMiniature = firstRack.locator('.cage-room-rack-preview [data-cage-status="active"]').first();
  await expect(occupiedMiniature).toBeVisible();
  const miniature = (await occupiedMiniature.boundingBox())!;
  expect(miniature.width).toBeGreaterThan(12);
  expect(miniature.height).toBeGreaterThan(6);
  await expectSquare(occupiedMiniature);
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
    await expect(zoom).toHaveText("300%");
    await expect(firstRack).toHaveAttribute("aria-pressed", "false");
    await map.scrollIntoViewIfNeeded();
    await expect(firstSlot).toBeInViewport();
    await expectSquare(firstSlot);
    await expect(firstSlot).toContainText("Z2026001");
    await expect(firstSlot.getByText("甲负责人 乙实验员", { exact: true })).toBeVisible();
    await expect(firstSlot.getByText("小鼠", { exact: true })).toBeVisible();
    await expect(firstSlot.getByText("3 只", { exact: true })).toBeVisible();
    if (height < 500) {
      await page.screenshot({ path: testInfo.outputPath("room-map-detail-landscape.png"), animations: "disabled" });
    }
    await firstRack.press("Escape");
    await expect(zoom).toHaveText("100%");
    await expect(firstSlot).toBeHidden();
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
  await zoomIn.click();
  await expect.poll(async () => (await floorGeometry()).width).toBeGreaterThan(beforeZoom.width);
  const enlarged = await floorGeometry();
  expect(enlarged.racks).toHaveLength(beforeZoom.racks.length);
  for (const [index, [column, row]] of enlarged.racks.entries()) {
    expect(column).toBeCloseTo(beforeZoom.racks[index][0], 3);
    expect(row).toBeCloseTo(beforeZoom.racks[index][1], 3);
  }
  await page.getByRole("button", { name: "缩小房间图", exact: true }).click();
  await expect.poll(async () => Math.abs((await floorGeometry()).width - beforeZoom.width)).toBeLessThan(1);
  await page.setViewportSize({ width: 1226, height: 725 });
  const zoomPosition = await zoomControlPosition();
  expect(zoomPosition.slice(1)).toEqual([8, 8]);
  const wheel = (target: typeof map, ctrlKey: boolean) =>
    target.evaluate((element, modifier) => {
      const bounds = element.getBoundingClientRect();
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: modifier,
        deltaY: -120,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }, ctrlKey);
  expect(await wheel(header, true)).toBe(false);
  expect(await wheel(map, false)).toBe(false);
  await expect(zoom).toHaveText("100%");
  expect(await wheel(map, true)).toBe(true);
  await expect(zoom).toHaveText("200%");
  expect(await zoomControlPosition()).toEqual(zoomPosition);
  const miniatureWithSummary = secondRack.locator(".cage-room-slot").filter({ hasText: "Z2026002" });
  const neighboringSummary = secondRack.locator(".cage-room-slot").filter({ hasText: /z2026001/i });
  await expectSquare(miniatureWithSummary);
  await expect(miniatureWithSummary.getByText("B1", { exact: true })).toBeVisible();
  await expect(miniatureWithSummary.getByText("Z2026002", { exact: true })).toBeVisible();
  await expect(neighboringSummary.getByText("3 只", { exact: true })).toBeVisible();
  await expect(miniatureWithSummary.getByText("甲负责人 乙实验员", { exact: true })).toBeVisible();
  await expect(miniatureWithSummary.getByText("C57BL/6J", { exact: true })).toBeVisible();
  await expect(secondRack.getByText("猴", { exact: true })).toBeVisible();
  await expect(secondSlot).toBeHidden();
  const summaryFits = await miniatureWithSummary.evaluate((slot) => {
    const bounds = slot.getBoundingClientRect();
    const sections = [...slot.querySelectorAll(".cage-room-slot-summary > span, .cage-room-slot-header")];
    const rects = sections.map((section) => section.getBoundingClientRect());
    return (
      rects.length === 3 &&
      rects.every((rect, index) => {
        const top = rects[index - 1]?.bottom ?? bounds.top;
        return rect.top >= top && rect.bottom <= bounds.bottom;
      })
    );
  });
  expect(summaryFits).toBe(true);
  await miniatureWithSummary.scrollIntoViewIfNeeded();
  const summaryColors = new Map<string, [string, string]>();
  const rgb = (color: string) => color.match(/\d+/g)!.slice(0, 3).map(Number);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const pair: [string, string] = [await fill(neighboringSummary), await fill(miniatureWithSummary)];
    const right = rgb(pair[1]);
    // The two neighboring IACUCs have the same principal. A small shade change is easy to miss.
    expect(Math.hypot(...rgb(pair[0]).map((channel, index) => channel - right[index]))).toBeGreaterThan(65);
    summaryColors.set(theme, pair);
    const screenshot = theme === "light" ? "room-map-cage-summary.png" : "room-map-cage-summary-dark.png";
    await page.screenshot({ path: testInfo.outputPath(screenshot), animations: "disabled" });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await map.hover({ position: { x: 12, y: 12 } });
  await page.keyboard.press("Control+=");
  await expect(zoom).toHaveText("300%");
  expect(await zoomControlPosition()).toEqual(zoomPosition);
  await map.evaluate((element) => element.scrollBy(40, 40));
  expect(await zoomControlPosition()).toEqual(zoomPosition);
  await expect(secondSlot.getByText("超期", { exact: true })).toBeVisible();
  await expect(secondSlot.getByText("甲负责人 乙实验员", { exact: true })).toBeVisible();
  await expect(secondSlot.getByText("猴", { exact: true })).toBeVisible();
  await expect(secondSlot.getByText("3 只", { exact: true })).toBeVisible();
  await expect(secondSlot).toHaveAccessibleName(/猴 · 3 只/);
  await expect(secondSlot.getByText(/雌 · .+岁/)).toBeVisible();
  await expect(thirdSlot.getByText("C57BL/6J", { exact: true })).toBeVisible();
  const statusDot = thirdSlot.locator(".slot-state-dot");
  await expect(statusDot).toBeVisible();
  await expect(statusDot).toHaveAttribute("title", "未填结束日期");
  await expect(thirdSlot).toHaveAccessibleName(/未填结束日期/);
  await expect(thirdSlot).not.toContainText(/未填结束日期|数量未填写/);
  await expect(thirdSlot.locator(".slot-animal-count")).toHaveCount(0);
  await expectSquare(secondSlot);
  await expectSquare(thirdSlot);
  const cardFits = await secondSlot.evaluate((slot) => {
    const bounds = slot.getBoundingClientRect();
    return [...slot.querySelectorAll(".slot-card-content > span")].every((section) => {
      const rect = section.getBoundingClientRect();
      return rect.top >= bounds.top && rect.bottom <= bounds.bottom && section.scrollHeight <= section.clientHeight;
    });
  });
  expect(cardFits).toBe(true);
  expect((await thirdSlot.boundingBox())!.width).toBeLessThanOrEqual(148);
  await expect(page.getByRole("region", { name: /笼位详情$/ })).toBeHidden();
  await secondSlot.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("room-map-cage-full.png"), animations: "disabled" });
  const fullCageText = await secondSlot.innerText();
  await zoom.click();
  await expect(zoom).toHaveText("100%");
  await secondRack.click();
  await expect(zoom).toHaveText("300%");
  await expect(secondSlot).toHaveText(fullCageText, { useInnerText: true });
  await firstSlot.click();
  const cageEditor = page.getByRole("dialog", { name: `编辑笼位 ${roomName}-01-A1` });
  await expect(cageEditor).toBeVisible();
  await expect(cageEditor.getByLabel("品系", { exact: true })).toHaveValue("");
  await expect(cageEditor.getByLabel("规格（体重/日龄）", { exact: true })).toHaveValue("");
  await cageEditor.getByLabel("品系", { exact: true }).fill("BALB/c");
  await cageEditor.getByLabel("规格（体重/日龄）", { exact: true }).fill("18–22 g");
  await selectAntOptionByKeyboard(page, cageEditor.getByRole("combobox", { name: "性别", exact: true }), 1);
  await cageEditor.getByRole("button", { name: "保存笼位", exact: true }).click();
  await expect(cageEditor).toBeHidden();
  await expect(firstSlot.getByText("BALB/c", { exact: true })).toBeVisible();
  await firstSlot.click();
  await expect(cageEditor.getByLabel("规格（体重/日龄）", { exact: true })).toHaveValue("18–22 g");
  await expect(cageEditor.getByLabel("品系", { exact: true })).toHaveValue("BALB/c");
  await expect(
    cageEditor.getByRole("combobox", { name: "性别", exact: true }).locator("xpath=ancestor::label[1]"),
  ).toContainText("雄");
  await cageEditor.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(cageEditor).toBeHidden();
  await zoom.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await readLayout()).toEqual(savedBeforeZoom);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await firstRack.click();
    const firstColor = await fill(firstSlot);
    await secondRack.click();
    await expect(secondRack).toHaveAttribute("aria-pressed", "false");
    await expect(secondSlot).toHaveAttribute("data-cage-status", "overdue");
    await expect(secondSlot.getByText("猴", { exact: true })).toBeVisible();
    await expect(thirdSlot.getByText("C57BL/6J", { exact: true })).toBeVisible();
    await expect(secondSlot).toHaveCSS("border-top-style", "solid");
    expect([await fill(secondSlot), await fill(thirdSlot)]).toEqual(summaryColors.get(theme));
    expect(await fill(secondSlot)).toBe(firstColor);
    await captureUiAudit(page, testInfo, `room-layout-${theme}`, page.locator(".cage-room-workbench"));
    await zoom.click();
  }

  await firstRack.click();
  await zoom.click();
  const edit = page.getByRole("button", { name: "编辑布局" });
  await edit.click();
  const dialog = page.getByRole("dialog", { name: "编辑笼架布局" });
  const editedRack = dialog.getByRole("button", { name: /^测试笼架 1/ });
  const position = dialog.getByRole("status");
  await expect(position).toHaveText(/第 5 列 · 第 5 行 · 0°/);
  const gridStep = await dialog
    .locator(".cage-room-map")
    .evaluate((board) => parseFloat(getComputedStyle(board).backgroundSize));
  const editedBounds = (await editedRack.boundingBox())!;
  const neighboringRack = dialog.getByRole("button", { name: /^测试笼架 2/ });
  const neighboringBounds = (await neighboringRack.boundingBox())!;
  expect(editedBounds.width).toBeLessThan(neighboringBounds.width);
  expect(editedBounds.height).toBeGreaterThan(neighboringBounds.height);
  const previewGutter = await neighboringRack.evaluate((element) => {
    const grid = element.querySelector(".cage-room-rack-preview")!;
    const styles = getComputedStyle(grid);
    const columns = styles.gridTemplateColumns.split(" ").map((track) => parseFloat(track));
    const gridWidth =
      columns.reduce((total, column) => total + column, 0) + parseFloat(styles.columnGap) * (columns.length - 1);
    return element.getBoundingClientRect().right - grid.getBoundingClientRect().left - gridWidth;
  });
  expect(previewGutter).toBeGreaterThanOrEqual(0);
  expect(previewGutter).toBeLessThanOrEqual(12);
  const moveRight = dialog.getByRole("button", { name: "右移一格" });
  await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeFocused();
  await editedRack.focus();
  await expect(editedRack).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(position).toHaveText(/第 6 列 · 第 5 行 · 0°/);
  for (let step = 0; step < 7; step += 1) await moveRight.click();
  await moveRight.click();
  await expect(dialog.getByText(/与其他笼架重叠/)).toBeVisible();
  await expect(position).toHaveText(/第 13 列 · 第 5 行 · 0°/);

  const footprint = (await editedRack.boundingBox())!;
  const x = footprint.x + footprint.width / 2;
  const y = footprint.y + footprint.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - gridStep, y, { steps: 4 });
  const drop = (await dialog.locator(".cage-room-rack-drop").boundingBox())!;
  expect(drop.width).toBeCloseTo(footprint.width, 0);
  expect(drop.height).toBeCloseTo(footprint.height, 0);
  await page.mouse.up();
  await expect(position).toHaveText(/第 12 列 · 第 5 行 · 0°/);
  await dialog.getByRole("button", { name: "旋转 90°" }).click();
  await expect(position).toHaveText(/第 12 列 · 第 5 行 · 90°/);
  const rotatedBounds = (await editedRack.boundingBox())!;
  expect(rotatedBounds.width).toBeLessThan(rotatedBounds.height);
  await dialog.getByRole("button", { name: "保存布局" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  const editedLayout = (await readLayout())!;
  expect(editedLayout.placements).toContainEqual({ rackId: rackIds[0], column: 2.75, row: 1, rotation: 90 });
  await page.reload();
  await chooseCageRoom(page, roomName);
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
  await chooseCageRoom(page, roomName);
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

  await page.emulateMedia({ reducedMotion: "no-preference" });
  const animated = await zoomIn.evaluate(async (button: HTMLButtonElement) => {
    const board = button.closest(".cage-room-map-frame")?.querySelector(".cage-room-map");
    button.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const motion = board?.getAnimations()[0];
    if (!motion) return false;
    await motion.finished;
    return true;
  });
  expect(animated).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await zoom.click();
  expect(await map.locator(".cage-room-map").evaluate((board) => board.getAnimations().length)).toBe(0);
});
