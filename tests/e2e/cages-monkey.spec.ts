import { expect, selectAntOptionByKeyboard, test } from "./fixtures";

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

test("monkey rooms preserve sex, birth date, and calculated age", async ({ page }, testInfo) => {
  await page.goto("/app");
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

  await page.getByRole("menuitem", { name: /笼位管理/ }).click();
  await page.locator("#cages-room-select").click();
  await page.locator(".ant-select-dropdown").filter({ visible: true }).getByText("E2E 猴房", { exact: true }).click();
  await expect(
    page.locator("#cages-room-select").locator("xpath=ancestor::div[contains(@class, 'ant-select')][1]"),
  ).toContainText("E2E 猴房");
  await page.getByRole("button", { name: /E2E 猴房-01-A1/ }).click();
  await expect(page.getByRole("group", { name: "猴个体信息", exact: true })).toBeVisible();
  await selectAntOptionByKeyboard(page, page.getByRole("combobox", { name: "性别", exact: true }), 2);
  await page.getByLabel("出生日期", { exact: true }).fill("2024-01-15");
  await page.getByLabel("出生日期", { exact: true }).press("Tab");
  await expect(page.getByLabel("年龄", { exact: true })).not.toHaveValue("自动计算");
  for (const [width, height] of [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("dialog")).toHaveCSS("transform", "none");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const geometry = await page.getByRole("group", { name: "猴个体信息", exact: true }).evaluate((root) => {
      const birth = root.querySelector('[aria-label="出生日期"]')!;
      const picker = birth.closest(".ant-picker")!;
      const sex = root.querySelector("#cage-slot-sex")!.closest(".ant-select")!;
      const age = root.querySelector("#monkey-age")!;
      const clear = picker.querySelector(".ant-picker-clear")!;
      const controls = [sex, picker, age].map((element) => ({
        height: element.getBoundingClientRect().height,
        top: element.getBoundingClientRect().top,
        minHeight: getComputedStyle(element).minHeight,
        radius: getComputedStyle(element).borderRadius,
      }));
      const rules: { selector: string; css: string }[] = [];
      const collect = (items: CSSRuleList) => {
        for (const rule of items) {
          if (
            rule instanceof CSSStyleRule &&
            /compact-slot-form|compact-form-row|cage-slot-modal button/.test(rule.selectorText)
          ) {
            rules.push({ selector: rule.selectorText, css: rule.style.cssText });
          } else if (rule instanceof CSSGroupingRule) collect(rule.cssRules);
        }
      };
      for (const sheet of document.styleSheets) collect(sheet.cssRules);
      return {
        controls,
        inputHeight: birth.getBoundingClientRect().height,
        clear: {
          height: clear.getBoundingClientRect().height,
          width: clear.getBoundingClientRect().width,
          minHeight: getComputedStyle(clear).minHeight,
        },
        row: {
          display: getComputedStyle(sex.parentElement!.parentElement!).display,
          alignItems: getComputedStyle(sex.parentElement!.parentElement!).alignItems,
        },
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        rules,
      };
    });
    await testInfo.attach(`cage-editor-${width}-geometry`, {
      body: JSON.stringify(geometry),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath(`cage-editor-${width}.png`), animations: "disabled" });
    expect(geometry.controls.map((control) => control.height)).toEqual([32, 32, 32]);
    expect(geometry.clear.height).toBe(geometry.clear.width);
    expect(geometry.clear.height).toBeLessThan(32);
    expect(geometry.pageOverflow).toBe(false);
    if (width > 760) expect(new Set(geometry.controls.map((control) => control.top)).size).toBe(1);
    const birth = page.getByLabel("出生日期", { exact: true });
    await birth.focus();
    await birth.press("Tab");
    const clear = page
      .getByRole("group", { name: "猴个体信息", exact: true })
      .getByRole("button", { name: "清除", exact: true });
    await expect(clear).toBeFocused();
    await expect(clear).not.toHaveCSS("outline-style", "none");
    await clear.press("Enter");
    await expect(birth).toHaveValue("");
    await expect(page.getByLabel("年龄", { exact: true })).toHaveValue("自动计算");
    await birth.fill("2024-01-15");
    await birth.press("Tab");
    await expect(page.getByLabel("年龄", { exact: true })).not.toHaveValue("自动计算");
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "保存笼位", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已保存" })).toContainText("已保存");

  const response = await page.request.get("/api/bootstrap?scope=room&roomId=room-e2e-monkey");
  const data = (await response.json()) as { occupancies: Array<{ animalSex?: string; birthDate?: string }> };
  expect(data.occupancies).toEqual(
    expect.arrayContaining([expect.objectContaining({ animalSex: "female", birthDate: "2024-01-15" })]),
  );
});
