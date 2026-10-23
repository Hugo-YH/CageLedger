import { ensureTestInfrastructure, expect, openNavigationEntry, selectAntOptionByKeyboard, test } from "./fixtures";

test("desktop inspection help buttons remain circular at supported widths", async ({ page }) => {
  await page.setViewportSize({ width: 1362, height: 652 });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("menuitem", { name: /动物管理/ }).click();
  await page.getByRole("menuitem", { name: /动物巡检/ }).click();

  const helpButton = page.getByRole("button", { name: "基础评估说明" });
  await expect(helpButton).toBeVisible();

  for (const viewport of [
    { width: 1362, height: 652 },
    { width: 1180, height: 800 },
    { width: 768, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const box = await helpButton.boundingBox();
    expect(box?.width).toBe(24);
    expect(box?.height).toBe(24);
    await expect(helpButton).toHaveCSS("border-radius", "50%");
  }
});

test("mobile inspection module selector keeps long labels within its options", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("tab", { name: "动物", exact: true }).click();

  const selector = page.locator(".inspection-module-selector");
  const abnormalOption = selector.getByText("异常动物（小鼠）评估", { exact: true });
  await expect(selector).toBeVisible();
  await expect(abnormalOption).toBeVisible();
  await expect(abnormalOption).toHaveCSS("white-space", "normal");
  await expect(abnormalOption).toHaveCSS("padding-right", "28px");
  expect(
    await selector
      .locator(".adm-selector-item")
      .evaluateAll((items) => items.every((item) => item.scrollWidth <= item.clientWidth)),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true,
  );

  await abnormalOption.click();
  const abnormalModule = page.locator('[data-module="abnormalAnimalAssessment"]');
  await expect(abnormalModule).toBeVisible();
  const headerOverflow = await abnormalModule
    .locator(".inspection-section-collapse > .ant-collapse-item > .ant-collapse-header")
    .evaluateAll((headers) =>
      headers.map((header) => {
        const headerBox = header.getBoundingClientRect();
        const cardBox = header.closest(".inspection-module-card")?.getBoundingClientRect();
        const iconBox = header.querySelector(".ant-collapse-expand-icon")?.getBoundingClientRect();
        return {
          right: headerBox.right,
          cardRight: cardBox?.right ?? 0,
          iconRight: iconBox?.right ?? 0,
        };
      }),
    );
  expect(headerOverflow.every(({ right, cardRight, iconRight }) => right <= cardRight && iconRight <= cardRight)).toBe(
    true,
  );

  await abnormalModule
    .locator(".inspection-section-collapse > .ant-collapse-item > .ant-collapse-header")
    .first()
    .click();
  const subsectionOverflow = await abnormalModule
    .locator(".inspection-subsection-collapse > .ant-collapse-item > .ant-collapse-header")
    .evaluateAll((headers) =>
      headers.map((header) => {
        const cardBox = header.closest(".inspection-module-card")?.getBoundingClientRect();
        const iconBox = header.querySelector(".ant-collapse-expand-icon")?.getBoundingClientRect();
        return { cardRight: cardBox?.right ?? 0, iconRight: iconBox?.right ?? 0 };
      }),
    );
  expect(subsectionOverflow.length).toBeGreaterThan(0);
  expect(subsectionOverflow.every(({ cardRight, iconRight }) => iconRight <= cardRight)).toBe(true);
});

test("section normal confirmation preserves finding metadata and saves every answer", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  await openNavigationEntry(page, "动物管理", "动物巡检");
  await selectAntOptionByKeyboard(page, page.getByRole("combobox", { name: "设施", exact: true }));
  await page.getByRole("combobox", { name: "饲养间", exact: true }).click();
  await page.getByText("8014", { exact: true }).last().click();
  const module = page.locator('.inspection-module-card[data-module="basicAssessment"]');
  const section = module.locator(".inspection-section").first();
  await section.locator(".ant-collapse-header").click();
  const sectionAnswerCount = await section.locator(".inspection-node").count();
  expect(sectionAnswerCount).toBeGreaterThan(1);
  const first = section.locator(".inspection-node").first();
  await first.getByRole("button", { name: "异常", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(".ant-form-item").filter({ hasText: "笼架" }).locator("input").fill("测试笼架");
  await dialog.locator(".ant-form-item").filter({ hasText: "笼号" }).locator("input").fill("C01");
  await dialog.locator(".ant-form-item").filter({ hasText: "动物标识" }).locator("input").fill("TEST-ANIMAL");
  await dialog.locator("textarea").fill("保留现场记录");
  await dialog.getByRole("button", { name: "确认异常", exact: true }).click();
  await expect(first.getByRole("button", { name: "异常", exact: true })).toHaveAttribute("aria-pressed", "true");
  await section.getByRole("button", { name: "全部正常", exact: true }).click();
  await expect(section.locator(".inspection-section-state")).toContainText("已确认");
  const savedResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/animal-inspections") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const response = await savedResponse;
  expect(response.ok(), await response.text()).toBe(true);
  const payload = response.request().postDataJSON();
  expect(payload.answers).toHaveLength(sectionAnswerCount);
  expect(payload.answers.every((answer: { outcome: string }) => answer.outcome === "normal")).toBe(true);
  const originalFinding = payload.answers.find(
    (answer: { animalIdentifier?: string }) => answer.animalIdentifier === "TEST-ANIMAL",
  );
  expect(originalFinding).toMatchObject({
    rackHint: "测试笼架",
    cageNumber: "C01",
    note: "保留现场记录",
    outcome: "normal",
  });
  const detail = await (await page.request.get(`/api/animal-inspections/${(await response.json()).item.id}`)).json();
  expect(detail.answers).toHaveLength(payload.answers.length);
});
