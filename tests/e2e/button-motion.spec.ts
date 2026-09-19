import { expect, test } from "./fixtures";

test("buttons use one press feedback and stop moving while submitting", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  const button = page.getByRole("button", { name: "登录", exact: true });
  const read = () =>
    button.evaluate((el) => ({
      transform: getComputedStyle(el).transform,
      transition: getComputedStyle(el).transitionDuration,
    }));
  await button.hover();
  expect((await read()).transform).toBe("none");
  await page.mouse.down();
  await expect.poll(async () => (await read()).transform).toBe("matrix(0.98, 0, 0, 0.98, 0, 0)");
  const pressed = await read();
  expect(pressed.transition.split(", ").every((value) => value === "0.14s")).toBe(true);
  await page.mouse.move(1, 1);
  await page.mouse.up();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/auth/login", async (route) => {
    await gate;
    await route.fallback();
  });
  await button.click();
  await expect(button).toHaveClass(/ant-btn-loading/);
  await button.hover();
  await page.mouse.down();
  await expect.poll(async () => (await read()).transform).toBe("none");
  const loading = await read();
  await page.mouse.move(1, 1);
  await page.mouse.up();
  release();
  await expect(button).toBeHidden();
  await testInfo.attach("button-motion-styles", {
    body: JSON.stringify({ pressed, loading }),
    contentType: "application/json",
  });
});
