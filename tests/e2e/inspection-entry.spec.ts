import { expect, test } from "./fixtures";

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
