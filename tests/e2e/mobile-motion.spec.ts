import { expect, openQuantityEntry, test } from "./fixtures";
import type { Page } from "@playwright/test";

async function recordPopupFrames(page: Page, beforeClick = false) {
  await page.evaluate((waitForClick) => {
    const target = window as typeof window & {
      popupFrames?: Promise<Array<{ y: number; opacity: number | null }>>;
    };
    target.popupFrames = new Promise((resolve) => {
      const frames: Array<{ y: number; opacity: number | null }> = [];
      let remaining = 12;
      const sample = () => {
        const body = document.querySelector<HTMLElement>(".adm-popup-body");
        if (body?.getClientRects().length && getComputedStyle(body.closest(".adm-popup")!).display !== "none") {
          const mask = document.querySelector(".adm-popup .adm-mask");
          frames.push({
            y: new DOMMatrixReadOnly(getComputedStyle(body).transform).m42,
            opacity: mask ? Number(getComputedStyle(mask).opacity) : null,
          });
        }
        if (--remaining) requestAnimationFrame(sample);
        else resolve(frames);
      };
      const start = () => requestAnimationFrame(sample);
      if (waitForClick) document.addEventListener("click", start, { once: true, capture: true });
      else start();
    });
  }, beforeClick);
}

async function popupFrames(page: Page) {
  return await page.evaluate(async () => {
    const target = window as typeof window & {
      popupFrames?: Promise<Array<{ y: number; opacity: number | null }>>;
    };
    return await target.popupFrames!;
  });
}

async function expectSettledFrames(page: Page) {
  const frames = await popupFrames(page);
  expect(frames.length).toBeGreaterThan(0);
  expect(
    frames.every(({ y }) => Math.abs(y) < 0.5),
    JSON.stringify(frames),
  ).toBe(true);
  return frames;
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 667, height: 375 },
  { width: 760, height: 900 },
]) {
  for (const changeDuringOpening of [false, true]) {
    test(`mobile popup respects reduced motion${changeDuringOpening ? " during opening" : " on mount"} ${viewport.width}x${viewport.height}`, async ({
      page,
    }, info) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: changeDuringOpening ? "no-preference" : "reduce" });
      await page.goto("/app");
      await page.getByLabel("用户名", { exact: true }).fill("admin");
      await page.getByLabel("密码", { exact: true }).fill("admin123");
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await openQuantityEntry(page);
      const draft = page.getByRole("textbox", { name: "项目名称", exact: true });
      await draft.fill("动效切换后保留的草稿");
      await expect(page.locator(".ant-mobile-navigation-sheet")).toBeHidden();
      const initialOverflow = await page.evaluate(() => document.body.style.overflow);
      const more = page.getByRole("tab", { name: "更多", exact: true });
      if (!changeDuringOpening) await recordPopupFrames(page, true);
      await more.click();
      if (changeDuringOpening) {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await recordPopupFrames(page);
      }
      const frames = await expectSettledFrames(page);
      await info.attach("mobile-popup-motion-frames", {
        body: JSON.stringify(frames),
        contentType: "application/json",
      });
      const sheet = page.locator(".ant-mobile-navigation-sheet");
      await expect(sheet).toBeInViewport({ ratio: 1 });
      await expect(page.locator(".ant-mobile-navigation-mask")).toHaveCSS("opacity", "1");
      await page.screenshot({ path: info.outputPath("mobile-popup-reduced.png"), animations: "disabled" });
      await sheet.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(sheet).toBeHidden();
      await expect(draft).toHaveValue("动效切换后保留的草稿");
      await page.setViewportSize({ width: 1180, height: 900 });
      await expect(more).toBeHidden();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.setViewportSize(viewport);
      await recordPopupFrames(page, true);
      await more.click();
      const normalFrames = await popupFrames(page);
      expect(
        normalFrames.some(({ y }) => Math.abs(y) > 0.5),
        JSON.stringify(normalFrames),
      ).toBe(true);
      await info.attach("mobile-popup-normal-motion-frames", {
        body: JSON.stringify(normalFrames),
        contentType: "application/json",
      });
      await expect(sheet).toBeInViewport({ ratio: 1 });
      await sheet.getByRole("button", { name: "关闭", exact: true }).click();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(sheet).toBeHidden();
      const interaction = await more.evaluate(
        (element) =>
          new Promise<{ available: boolean; overflow: string }>((resolve) => {
            requestAnimationFrame(() => {
              const bounds = element.getBoundingClientRect();
              resolve({
                available: element.contains(
                  document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
                ),
                overflow: document.body.style.overflow,
              });
            });
          }),
      );
      expect(interaction).toEqual({ available: true, overflow: initialOverflow });
      await more.click();
      await expect(sheet).toBeInViewport({ ratio: 1 });
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(draft).toHaveValue("动效切换后保留的草稿");
    });
  }
}
