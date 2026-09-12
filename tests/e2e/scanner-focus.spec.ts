import { writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { qrCodeMatrix } from "../../src/react/print/qrCode";
import { expect, openNavigationEntry, test } from "./fixtures";

const payload = "https://example.test/c/AB12";
const response = { qrId: "AB12", batchNo: "透视扫码回归", statusLabel: "已接收", iacuc: "TEST-FOCUS" };

test.beforeEach(async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
  await openNavigationEntry(page, "笼卡管理", "二维码扫描");
});

/** Draw an off-center perspective QR without relying on the production geometry helper. */
async function installCamera(page: Page) {
  return page.evaluateHandle((modules) => {
    const tracks: MediaStreamTrack[] = [];
    const cameras: HTMLCanvasElement[] = [];
    const project = (u: number, v: number) => ({
      x: (320 * u + 30 * v + 70) / (1 + 0.15 * u + 0.2 * v),
      y: (75 * u + 310 * v + 45) / (1 + 0.15 * u + 0.2 * v),
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        cameras.push(canvas);
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#dbe6ea";
        context.fillRect(0, 0, canvas.width, canvas.height);
        // Later starts use a blank live frame so cancellation can be inspected independently.
        if (!tracks.length) {
          const polygon = (u0: number, v0: number, u1: number, v1: number) => {
            const corners = [project(u0, v0), project(u1, v0), project(u1, v1), project(u0, v1)];
            context.moveTo(corners[0].x, corners[0].y);
            corners.slice(1).forEach(({ x, y }) => context.lineTo(x, y));
            context.closePath();
          };
          context.fillStyle = "white";
          context.beginPath();
          polygon(0, 0, 1, 1);
          context.fill();
          context.fillStyle = "black";
          context.beginPath();
          const side = modules.length + 8;
          modules.forEach((row, y) =>
            row.forEach((dark, x) => {
              if (dark) polygon((x + 4) / side, (y + 4) / side, (x + 5) / side, (y + 5) / side);
            }),
          );
          // One compound fill prevents artificial antialias seams between neighboring black modules.
          context.fill();
        }
        const stream = canvas.captureStream(10);
        tracks.push(stream.getVideoTracks()[0]);
        return Promise.resolve(stream);
      },
    });
    return { tracks, cameras };
  }, qrCodeMatrix(payload));
}

async function observeCapture(page: Page) {
  return page.evaluateHandle(() => {
    const longTasks: Array<{ at: number; duration: number }> = [];
    const performanceObserver = new PerformanceObserver((list) => {
      list
        .getEntries()
        .forEach((entry) => longTasks.push({ at: performance.timeOrigin + entry.startTime, duration: entry.duration }));
    });
    performanceObserver.observe({ type: "longtask" });
    const observations: Array<{ phase: string; at: number; width: number; transform: string; keyframes: unknown }> = [];
    const observer = new MutationObserver(() => {
      const stage = document.querySelector<HTMLElement>(".scanner-capture");
      const plane = stage?.querySelector<HTMLElement>(".scanner-qr-plane");
      if (!stage || !plane || getComputedStyle(plane).visibility !== "visible") return;
      observations.push({
        phase: stage.dataset.phase || "",
        at: Date.now(),
        width: plane.getBoundingClientRect().width,
        transform: getComputedStyle(plane).transform,
        keyframes: plane.getAnimations().map((animation) => (animation.effect as KeyframeEffect).getKeyframes()),
      });
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    return { observations, observer, longTasks, performanceObserver };
  });
}

async function correctedCode(page: Page) {
  return page.locator(".scanner-qr-plane img").evaluate(async (element: HTMLImageElement) => {
    const modulePath = "/src/vendor/jsQR.js";
    const imported = await import(modulePath);
    const decoder = imported.default || (window as unknown as { jsQR: typeof imported.default }).jsQR;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = element.naturalWidth + 256;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(element, 128, 128);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return decoder(image.data, image.width, image.height)?.data || "";
  });
}

test("real tilted QR freezes, aligns independently of a slow lookup, and survives retry and four viewport sizes", async ({
  page,
}, testInfo) => {
  let release!: () => void;
  const lookup = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  let requestedAt = 0;
  await page.route("**/api/public/cage-card/AB12", async (route) => {
    requests += 1;
    requestedAt ||= Date.now();
    if (requests === 1) {
      await lookup;
      await route.fulfill({ status: 503, json: { error: "测试查询暂时不可用" } });
    } else await route.fulfill({ json: { item: response } });
  });
  const camera = await installCamera(page);
  const observation = await observeCapture(page);
  await page.getByRole("button", { name: "启动摄像头", exact: true }).click();
  await expect(page.getByLabel("笼卡识别码")).toHaveValue("AB12");
  const stage = page.locator(".scanner-capture");
  await expect(stage).toHaveAttribute("data-phase", "aligned");
  await expect(page.getByLabel("笼卡信息正在加载")).toBeVisible();
  await expect(page.getByRole("button", { name: "继续扫码", exact: true })).toBeEnabled();
  expect(await camera.evaluate(({ tracks }) => tracks[0].readyState)).toBe("ended");
  for (const [selector, name] of [
    [".scanner-qr-plane img", "corrected-qr.png"],
    [".scanner-frozen-frame", "original-frame.jpg"],
  ]) {
    const dataUrl = await page.locator(selector).getAttribute("src");
    await writeFile(testInfo.outputPath(name), Buffer.from(dataUrl!.split(",")[1], "base64"));
  }
  await stage.screenshot({ path: testInfo.outputPath("corrected-texture-debug.png") });
  expect(await correctedCode(page)).toBe(payload);
  const transitions = await observation.evaluate(({ observations }) => observations);
  expect(transitions.some(({ phase }) => phase === "located")).toBe(true);
  expect(transitions.some(({ phase }) => phase === "aligning")).toBe(true);
  const aligned = transitions.find(({ phase }) => phase === "aligned")!;
  expect(requestedAt).toBeLessThan(aligned.at);
  expect(transitions.find(({ phase }) => phase === "located")!.width).toBeLessThan(aligned.width * 0.8);
  await testInfo.attach("qr-alignment-transitions", {
    body: JSON.stringify(transitions),
    contentType: "application/json",
  });
  await writeFile(testInfo.outputPath("qr-alignment-transitions.json"), JSON.stringify(transitions, null, 2));
  await writeFile(
    testInfo.outputPath("qr-feedback-timing.json"),
    JSON.stringify(
      {
        requestedAt,
        firstLocatedAt: transitions.find(({ phase }) => phase === "located")!.at,
        alignedAt: aligned.at,
        longTasks: await observation.evaluate(({ longTasks }) => longTasks),
      },
      null,
      2,
    ),
  );
  release();
  await expect(page.getByText("查询失败", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重新查询", exact: true }).click();
  await expect(page.getByText("透视扫码回归", { exact: true }).first()).toBeVisible();
  expect(requests).toBe(2);
  for (const [width, height] of [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(stage).toHaveAttribute("data-phase", "aligned");
    await stage.scrollIntoViewIfNeeded();
    const geometry = await stage.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const plane = element.querySelector<HTMLElement>(".scanner-qr-plane")!;
      const bounds = plane.getBoundingClientRect();
      const style = getComputedStyle(plane);
      return {
        stage: rect.toJSON(),
        plane: bounds.toJSON(),
        transform: style.transform,
        origin: style.transformOrigin,
        overflow: getComputedStyle(element).overflow,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(geometry.pageOverflow).toBe(false);
    expect(geometry.plane.width / geometry.stage.width).toBeCloseTo(0.88, 2);
    expect(geometry.plane.width).toBeCloseTo(geometry.plane.height, 1);
    expect(geometry.plane.x).toBeGreaterThanOrEqual(geometry.stage.x);
    expect(geometry.plane.right).toBeLessThanOrEqual(geometry.stage.right);
    expect(geometry.origin).toBe("0px 0px");
    await testInfo.attach(`qr-focus-${width}-style`, {
      body: JSON.stringify(geometry),
      contentType: "application/json",
    });
    await writeFile(testInfo.outputPath(`qr-focus-${width}-style.json`), JSON.stringify(geometry, null, 2));
    await page.screenshot({ path: testInfo.outputPath(`qr-focus-${width}.png`) });
  }
});

test("perspective alignment has reviewable original, halfway and corrected frames", async ({ page }, testInfo) => {
  await page.route("**/api/public/cage-card/AB12", (route) => route.fulfill({ json: { item: response } }));
  await installCamera(page);
  await page.getByRole("button", { name: "启动摄像头", exact: true }).click();
  const stage = page.locator(".scanner-capture");
  await expect(stage).toHaveAttribute("data-phase", "aligning");
  const animations = await stage.evaluateHandle((element) => {
    const current = element.getAnimations({ subtree: true });
    current.forEach((animation) => animation.pause());
    return current;
  });
  expect(await animations.evaluate((current) => current.length)).toBe(2);
  for (const [name, time] of [
    ["original", 0],
    ["halfway", 420],
    ["corrected", 700],
  ] as const) {
    await animations.evaluate(
      (current, checkpoint) =>
        current.forEach((animation) => {
          animation.currentTime = checkpoint;
        }),
      time,
    );
    const path = testInfo.outputPath(`perspective-${name}.png`);
    await stage.screenshot({ path });
    await testInfo.attach(`perspective-${name}`, { path, contentType: "image/png" });
  }
  await animations.evaluate((current) => current.forEach((animation) => animation.finish()));
  await expect(stage).toHaveAttribute("data-phase", "aligned");
});

test("reduced motion presents the actual corrected QR immediately without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/public/cage-card/AB12", (route) => route.fulfill({ json: { item: response } }));
  await installCamera(page);
  const observation = await observeCapture(page);
  await page.getByRole("button", { name: "启动摄像头", exact: true }).click();
  await expect(page.locator(".scanner-capture")).toHaveAttribute("data-phase", "aligned");
  expect(await correctedCode(page)).toBe(payload);
  expect(await page.locator(".scanner-qr-plane").evaluate((element) => element.getAnimations().length)).toBe(0);
  expect(await observation.evaluate(({ observations }) => observations.some(({ phase }) => phase === "aligning"))).toBe(
    false,
  );
  await expect(page.getByText("透视扫码回归", { exact: true }).first()).toBeVisible();
});

test("changing motion preference during alignment settles without losing the detected code", async ({ page }) => {
  await page.route("**/api/public/cage-card/AB12", (route) => route.fulfill({ json: { item: response } }));
  await installCamera(page);
  await page.getByRole("button", { name: "启动摄像头", exact: true }).click();
  await expect(page.locator(".scanner-capture")).toHaveAttribute("data-phase", "aligning");
  const snapshot = await page.locator(".scanner-qr-plane img").elementHandle();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".scanner-capture")).toHaveAttribute("data-phase", "aligned");
  await expect(page.getByLabel("笼卡识别码")).toHaveValue("AB12");
  expect(
    await page.locator(".scanner-qr-plane img").evaluate((element, previous) => element === previous, snapshot),
  ).toBe(true);
  expect(await page.locator(".scanner-qr-plane").evaluate((element) => element.getAnimations().length)).toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(".scanner-capture")).toHaveAttribute("data-phase", "aligned");
  expect(await page.locator(".scanner-qr-plane").evaluate((element) => element.getAnimations().length)).toBe(0);
});

test("continue and navigation interrupt alignment without holding the camera or waiting for lookup", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/public/cage-card/AB12", async (route) => {
    await pending;
    await route.fulfill({ json: { item: response } });
  });
  const camera = await installCamera(page);
  await page.getByRole("button", { name: "启动摄像头", exact: true }).click();
  await expect(page.locator(".scanner-capture")).toHaveAttribute("data-phase", "aligning");
  await page.getByRole("button", { name: "继续扫码", exact: true }).click();
  await expect(page.locator(".scanner-capture")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "停止扫码", exact: true })).toBeEnabled();
  expect(await camera.evaluate(({ tracks }) => tracks.map((track) => track.readyState))).toEqual(["ended", "live"]);
  await page.getByRole("button", { name: "返回笼卡管理", exact: true }).click();
  await expect(page.getByLabel("笼卡扫码画面")).toHaveCount(0);
  expect(await camera.evaluate(({ tracks }) => tracks.every((track) => track.readyState === "ended"))).toBe(true);
  release();
});

test("leaving during correction cancels both visual animations immediately", async ({ page }) => {
  await page.route("**/api/public/cage-card/AB12", (route) => route.fulfill({ json: { item: response } }));
  const camera = await installCamera(page);
  await page.getByRole("button", { name: "启动摄像头", exact: true }).click();
  const stage = page.locator(".scanner-capture");
  await expect(stage).toHaveAttribute("data-phase", "aligning");
  const animations = await stage.evaluateHandle((element) => element.getAnimations({ subtree: true }));
  expect(await animations.evaluate((current) => current.length)).toBe(2);
  await page.getByRole("button", { name: "返回笼卡管理", exact: true }).click();
  await expect(stage).toHaveCount(0);
  expect(await animations.evaluate((current) => current.every((animation) => animation.playState === "idle"))).toBe(
    true,
  );
  expect(await camera.evaluate(({ tracks }) => tracks[0].readyState)).toBe("ended");
});
