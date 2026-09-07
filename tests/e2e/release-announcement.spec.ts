import { expect, test } from "./fixtures";
import { SYSTEM_RELEASE_NOTES } from "../../src/react/releaseNotes";
import { APP_VERSION } from "../../src/react/version";

const CURRENT_RELEASE_NOTE = SYSTEM_RELEASE_NOTES.find((note) => note.version === APP_VERSION)!;

test("shows each release once for the signed-in account and supports keyboard dismissal", async ({
  page,
}, testInfo) => {
  await page.unroute("**/api/release-announcements/*");
  const username = `release-note-${Date.now()}`;

  await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } });
  await page.request.post("/api/users", {
    data: {
      username,
      password: "release-note-password",
      displayName: "更新说明测试账号",
      role: "room_admin",
      roomIds: [],
    },
  });
  await page.request.post("/api/auth/logout");

  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill("release-note-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: `CageLedger ${APP_VERSION} 已更新` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(CURRENT_RELEASE_NOTE.title, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "我知道了", exact: true })).toBeFocused();

  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "compact", width: 1180, height: 820 },
    { name: "mobile", width: 760, height: 900 },
    { name: "landscape", width: 844, height: 390 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(dialog.getByRole("button", { name: "我知道了", exact: true })).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
    await testInfo.attach(`release-announcement-${viewport.name}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  }

  const acknowledgement = page.waitForResponse(
    (response) => response.url().includes(`/api/release-announcements/${APP_VERSION}/acknowledge`) && response.ok(),
  );
  await page.keyboard.press("Escape");
  await acknowledgement;
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
});
