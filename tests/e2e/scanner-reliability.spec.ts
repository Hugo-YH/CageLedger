import { expect, openNavigationEntry, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
  await openNavigationEntry(page, "笼卡管理", "二维码扫描");
});

test("camera video and input stay mounted across breakpoints and release on leaving", async ({ page }, testInfo) => {
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext("2d");
    context?.fillRect(0, 0, 320, 240);
    const stream = canvas.captureStream(10);
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => Promise.resolve(stream),
    });
  });
  const field = page.getByLabel("笼卡识别码");
  await field.fill("未提交草稿");
  const inputHandle = await field.elementHandle();
  await page.getByRole("button", { name: "启动摄像头", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止扫码", exact: true })).toBeVisible();
  const video = page.getByLabel("笼卡扫码画面");
  const videoHandle = await video.elementHandle();
  const track = await video.evaluateHandle((element: HTMLVideoElement) =>
    element.srcObject instanceof MediaStream ? element.srcObject.getVideoTracks()[0] : null,
  );
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1180, height: 820 },
    { width: 760, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(field).toHaveValue("未提交草稿");
    expect(await field.evaluate((element, original) => element === original, inputHandle)).toBe(true);
    expect(await video.evaluate((element, original) => element === original, videoHandle)).toBe(true);
    await expect(video).toBeVisible();
    expect(await track.evaluate((value) => value?.readyState)).toBe("live");
    for (const control of [
      page.locator(".scanner-code-field .ant-input-affix-wrapper"),
      page.getByRole("button", { name: "查询", exact: true }),
    ]) {
      await expect(control).toHaveCSS("height", "32px");
      const box = await control.boundingBox();
      if (!box) throw new Error("扫码控件不可见");
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
    const path = testInfo.outputPath(`scanner-${viewport.width}.png`);
    await page.screenshot({ path, animations: "disabled" });
    await testInfo.attach(`scanner-${viewport.width}`, { path, contentType: "image/png" });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "返回笼卡管理" }).click();
  await expect(video).toHaveCount(0);
  expect(await track.evaluate((value) => value?.readyState)).toBe("ended");
});

test("denied camera permission gives feedback and manual malformed codes do not crash", async ({ page }) => {
  await page.evaluate(() =>
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => Promise.reject(new Error("摄像头权限未授予")),
    }),
  );
  await page.getByRole("button", { name: "启动摄像头", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("摄像头权限未授予");
  await expect(page.getByRole("button", { name: "启动摄像头", exact: true })).toBeEnabled();
  await page.route("**/api/public/cage-card/**", (route) =>
    route.fulfill({ status: 404, json: { error: "识别码不存在" } }),
  );
  await page.getByLabel("笼卡识别码").fill("%invalid");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.getByText("查询失败", { exact: true })).toBeVisible();
  await expect(page.getByLabel("笼卡识别码")).toHaveValue("%invalid");
});

test("real camera frames decode and automatically query the cage card", async ({ page }, testInfo) => {
  const { qrCodeMatrix } = await import("../../src/react/print/qrCode");
  const matrix = qrCodeMatrix("https://example.test/c/AB12");
  await page.route("**/api/public/cage-card/AB12", (route) =>
    route.fulfill({
      json: {
        item: {
          qrId: "AB12",
          batchNo: "扫码回归批次",
          roomName: "测试饲养间",
          statusLabel: "已接收",
          iacuc: "TEST-IACUC",
        },
      },
    }),
  );
  const cameraTrack = await page.evaluateHandle((modules) => {
    const canvas = document.createElement("canvas");
    const cell = 8;
    canvas.width = canvas.height = (modules.length + 8) * cell;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "black";
    modules.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) context.fillRect((x + 4) * cell, (y + 4) * cell, cell, cell);
      }),
    );
    const stream = canvas.captureStream(10);
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => Promise.resolve(stream),
    });
    return stream.getVideoTracks()[0];
  }, matrix);
  await page.getByRole("button", { name: "启动摄像头", exact: true }).click();
  await expect(page.getByLabel("笼卡识别码")).toHaveValue("AB12");
  await expect(page.getByText("扫码回归批次", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: "已识别笼卡的冻结画面" })).toBeVisible();
  expect(await cameraTrack.evaluate((track) => track.readyState)).toBe("ended");
  await expect(page.getByRole("button", { name: "继续扫码", exact: true })).toBeEnabled();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1180, height: 820 },
    { width: 760, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const frozen = page.getByRole("img", { name: "已识别笼卡的冻结画面" });
    await frozen.scrollIntoViewIfNeeded();
    await expect(frozen).toBeInViewport();
    const box = await frozen.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    await testInfo.attach(`frozen-${viewport.width}`, { body: await page.screenshot(), contentType: "image/png" });
    await testInfo.attach(`frozen-style-${viewport.width}`, {
      body: JSON.stringify(
        await frozen.evaluate((element) => {
          const style = getComputedStyle(element);
          return { display: style.display, objectFit: style.objectFit, width: style.width, maxHeight: style.maxHeight };
        }),
      ),
      contentType: "application/json",
    });
  }
});
