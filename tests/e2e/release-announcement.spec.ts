import { expect, test } from "./fixtures";
import { SYSTEM_RELEASE_NOTES } from "../../src/react/releaseNotes";
import type { Page, Route } from "@playwright/test";
import { unreadReleaseNotes } from "../../src/react/features/shell/releaseAnnouncementModel";
import { APP_VERSION } from "../../src/react/version";

const CURRENT_RELEASE_NOTE = SYSTEM_RELEASE_NOTES.find((note) => note.version === APP_VERSION)!;

test("shows each release once for the signed-in account and supports keyboard dismissal", async ({
  page,
  browser,
}, testInfo) => {
  await page.unroute("**/api/release-announcements**");
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

  const dialog = page.getByRole("dialog", { name: "系统更新", exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(`${CURRENT_RELEASE_NOTE.version} · ${CURRENT_RELEASE_NOTE.title}`, { exact: true }),
  ).toBeVisible();
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
    if (viewport.name === "landscape") {
      const body = dialog.locator(".ant-modal-body");
      const bodyMetrics = await body.evaluate((element) => ({
        overflowY: getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }));
      expect(bodyMetrics.overflowY).toBe("auto");
      if (bodyMetrics.scrollHeight > bodyMetrics.clientHeight) {
        await body.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      }
      await expect(dialog.getByRole("button", { name: "我知道了", exact: true })).toBeVisible();
    }
    await testInfo.attach(`release-announcement-${viewport.name}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  }

  const acknowledgement = page.waitForResponse(
    (response) => response.url().endsWith("/api/release-announcements/acknowledge") && response.ok(),
  );
  await page.keyboard.press("Escape");
  await acknowledgement;
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();

  const status = await page.request.get("/api/release-announcements");
  expect(await status.json()).toEqual({ acknowledgedVersions: [APP_VERSION] });

  // Confirmation belongs to the account, not cookies or browser-local storage.
  const otherContext = await browser.newContext();
  try {
    const otherPage = await otherContext.newPage();
    await otherPage.goto(new URL("/app", page.url()).toString());
    await otherPage.getByLabel("用户名", { exact: true }).fill(username);
    await otherPage.getByLabel("密码", { exact: true }).fill("release-note-password");
    const loaded = otherPage.waitForResponse((response) => response.url().endsWith("/api/release-announcements"));
    await otherPage.getByRole("button", { name: "登录", exact: true }).click();
    await loaded;
    await expect(otherPage.getByRole("dialog", { name: "系统更新", exact: true })).toBeHidden();
  } finally {
    await otherContext.close();
  }
});

async function loginWithBaseline(page: Page, baseline: string) {
  await page.unroute("**/api/release-announcements**");
  const username = `missed-release-${Date.now()}`;
  await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } });
  const created = await page.request.post("/api/users", {
    data: { username, password: "release-note-password", displayName: "补看更新账号", role: "room_admin", roomIds: [] },
  });
  expect(created.ok()).toBe(true);
  await page.request.post("/api/auth/logout");
  await page.request.post("/api/auth/login", { data: { username, password: "release-note-password" } });
  // Seed the old endpoint to verify existing per-version records are still recognized.
  const acknowledged = await page.request.post(`/api/release-announcements/${baseline}/acknowledge`);
  expect(acknowledged.ok()).toBe(true);
  await page.goto("/app");
  await expect(page.getByRole("dialog", { name: "系统更新", exact: true })).toBeVisible();
}

test("missed releases share one dialog and only become acknowledged after a successful retry", async ({
  page,
}, testInfo) => {
  const baseline = SYSTEM_RELEASE_NOTES[3].version;
  const notes = unreadReleaseNotes(SYSTEM_RELEASE_NOTES, APP_VERSION, [baseline]);
  expect(notes.length).toBeGreaterThan(1);
  await loginWithBaseline(page, baseline);
  const dialog = page.getByRole("dialog", { name: "系统更新", exact: true });
  await expect(dialog.locator(".ant-collapse-header")).toHaveText(
    notes.map((note) => `${note.version} · ${note.title}`),
  );
  await expect(dialog).not.toContainText("你上次查看");
  await expect(dialog.getByText(notes[0].items[0], { exact: true })).toBeVisible();

  let firstRequest: Route | undefined;
  let attempts = 0;
  await page.route("**/api/release-announcements/acknowledge", (route) => {
    attempts += 1;
    expect(route.request().postDataJSON()).toEqual({ versions: notes.map((note) => note.version) });
    if (attempts === 1) firstRequest = route;
    else return route.continue();
  });
  await dialog.getByRole("button", { name: "我知道了", exact: true }).click();
  await expect.poll(() => attempts).toBe(1);
  await expect(dialog.getByRole("button", { name: "查看完整更新记录", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(attempts).toBe(1);
  await firstRequest!.fulfill({ status: 503, json: { error: "测试确认失败" } });
  await expect(dialog.getByRole("alert")).toContainText("确认未成功");
  expect(await (await page.request.get("/api/release-announcements")).json()).toEqual({
    acknowledgedVersions: [baseline],
  });
  await testInfo.attach("missed-releases-retry", { body: await page.screenshot(), contentType: "image/png" });

  await dialog.getByRole("button", { name: "我知道了", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(attempts).toBe(2);
  const saved = await (await page.request.get("/api/release-announcements")).json();
  expect(saved.acknowledgedVersions.sort()).toEqual([baseline, ...notes.map((note) => note.version)].sort());
  await page.reload();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
});

test("a long update list exposes every version, supports expansion, and opens the complete history", async ({
  page,
}, testInfo) => {
  const baseline = SYSTEM_RELEASE_NOTES[Math.min(7, SYSTEM_RELEASE_NOTES.length - 1)].version;
  const notes = unreadReleaseNotes(SYSTEM_RELEASE_NOTES, APP_VERSION, [baseline]);
  expect(notes.length).toBeGreaterThan(3);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loginWithBaseline(page, baseline);
  const dialog = page.getByRole("dialog", { name: "系统更新", exact: true });
  const first = dialog.locator(".ant-collapse-header").first();
  await expect(dialog.locator(".ant-collapse-header")).toHaveText(
    notes.map((note) => `${note.version} · ${note.title}`),
  );
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.getByText(notes[0].items[0], { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "我知道了", exact: true })).toBeInViewport();
  await testInfo.attach("missed-releases-long", { body: await page.screenshot(), contentType: "image/png" });
  await dialog.getByRole("button", { name: "查看完整更新记录", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/releases\//);
  const history = await (await page.request.get("/api/release-announcements")).json();
  expect(history.acknowledgedVersions.sort()).toEqual([baseline, ...notes.map((note) => note.version)].sort());
});
