import { expect, openNavigationEntry, openQuantityEntry, test } from "./fixtures";

for (const viewport of [
  { width: 1325, height: 644 },
  { width: 1180, height: 900 },
  { width: 760, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`quantity entry actions remain usable while scrolling at ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/app");
    await page.getByLabel("用户名", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("admin123");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await openQuantityEntry(page);
    const toolbar = page.locator(".quantity-entry-toolbar");
    await expect(toolbar).toBeVisible();
    const scroll = async (top: number) =>
      toolbar.evaluate((element, offset) => {
        let owner = element.parentElement;
        while (
          owner &&
          !(/auto|scroll/.test(getComputedStyle(owner).overflowY) && owner.scrollHeight > owner.clientHeight)
        ) {
          owner = owner.parentElement;
        }
        const target = owner ?? document.scrollingElement!;
        target.scrollTo({ top: offset, behavior: "instant" });
        return target.scrollTop;
      }, top);

    expect(await scroll(500)).toBeGreaterThan(300);
    if (viewport.height > 500) {
      await expect(toolbar).toBeInViewport({ ratio: 1 });
      await expect(toolbar).toHaveCSS("position", "sticky");
      const top = (await toolbar.boundingBox())!.y;
      await scroll(700);
      await expect.poll(async () => (await toolbar.boundingBox())!.y).toBeCloseTo(top, 0);
    } else {
      // A short landscape viewport keeps the existing non-sticky policy to leave room for the form.
      await expect(toolbar).toHaveCSS("position", "relative");
      await scroll(0);
    }
    const save = toolbar.getByRole("button", { name: "保存统计表", exact: true });
    await save.click({ trial: true });
    const evidence = await toolbar.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        position: getComputedStyle(element).position,
        top: rect.top,
        height: rect.height,
        right: rect.right,
        viewport: innerWidth,
        controls: [...element.querySelectorAll("button")].map((button) => ({
          label: button.textContent,
          height: getComputedStyle(button).height,
          radius: getComputedStyle(button).borderRadius,
        })),
      };
    });
    expect(evidence.right).toBeLessThanOrEqual(viewport.width);
    await testInfo.attach("toolbar-computed-style", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath("quantity-toolbar.png") });
  });
}

test("quantity editor restores sticky layout after zoom and a short visual viewport, then cleans up on navigation", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1180, height: 1000 });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeHidden();
  const workspace = page.locator('[data-ui="workspace"]');
  await workspace.evaluate((owner: HTMLElement) => {
    owner.style.scrollPaddingTop = "17px";
    owner.style.setProperty("--cl-workspace-toolbar-offset", "21px");
  });
  await openQuantityEntry(page);
  const toolbar = page.locator(".quantity-entry-toolbar");
  await expect(toolbar).toHaveCSS("position", "sticky");
  const offsets = () =>
    workspace.evaluate((owner: HTMLElement) => {
      return {
        padding: `${Math.round(parseFloat(owner.style.scrollPaddingTop))}px`,
        offset: `${Math.round(parseFloat(owner.style.getPropertyValue("--cl-workspace-toolbar-offset")))}px`,
      };
    });
  const activeOffsets = await offsets();
  expect(parseFloat(activeOffsets.padding)).toBeGreaterThan(17);

  await page.evaluate(() => {
    document.body.style.zoom = "3";
  });
  await expect
    .poll(() =>
      toolbar.evaluate(
        (element) => element.getBoundingClientRect().height > (window.visualViewport?.height ?? innerHeight) * 0.25,
      ),
    )
    .toBe(true);
  await expect(toolbar).toHaveCSS("position", "relative");
  expect(await offsets()).toEqual({ padding: "17px", offset: "21px" });
  await page.evaluate(() => {
    document.body.style.zoom = "1";
  });
  await expect(toolbar).toHaveCSS("position", "sticky");
  expect(await offsets()).toEqual(activeOffsets);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2.5 });
  await expect.poll(() => page.evaluate(() => window.visualViewport!.height)).toBeLessThanOrEqual(500);
  await expect(toolbar).toHaveCSS("position", "relative");
  expect(await offsets()).toEqual({ padding: "17px", offset: "21px" });
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  await expect(toolbar).toHaveCSS("position", "sticky");
  expect(await offsets()).toEqual(activeOffsets);
  await cdp.detach();

  for (const width of [1180, 760]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(toolbar).toHaveCSS("position", "sticky");
    const requiredField = page.getByLabel("IACUC 编号", { exact: true });
    await requiredField.evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
    const anchorGeometry = await toolbar.evaluate((element) => {
      const owner = element.closest<HTMLElement>('[data-ui="workspace"]')!;
      return {
        bar: element.getBoundingClientRect().toJSON(),
        owner: owner.getBoundingClientRect().toJSON(),
        padding: getComputedStyle(owner).paddingTop,
        scrollPadding: getComputedStyle(owner).scrollPaddingTop,
        inset: getComputedStyle(element).top,
        field: owner.querySelector('[aria-label="IACUC 编号"]')!.getBoundingClientRect().toJSON(),
      };
    });
    await expect
      .poll(
        async () =>
          (await requiredField.boundingBox())!.y -
          ((await toolbar.boundingBox())!.y + (await toolbar.boundingBox())!.height),
        { message: JSON.stringify(anchorGeometry) },
      )
      .toBeGreaterThanOrEqual(0);
    await workspace.evaluate((owner) => owner.scrollTo({ top: 700, behavior: "instant" }));
    await toolbar.getByRole("button", { name: "保存统计表", exact: true }).click();
    await expect(requiredField).toBeFocused();
    await expect
      .poll(
        async () =>
          (await requiredField.boundingBox())!.y -
          ((await toolbar.boundingBox())!.y + (await toolbar.boundingBox())!.height),
      )
      .toBeGreaterThanOrEqual(0);
    await testInfo.attach(`restored-scroll-offsets-${width}`, {
      body: JSON.stringify({ offsets: await offsets(), anchorGeometry }),
      contentType: "application/json",
    });
  }
  await openNavigationEntry(page, "检疫管理", "检疫批次");
  await expect(toolbar).toHaveCount(0);
  expect(await offsets()).toEqual({ padding: "17px", offset: "21px" });
});
