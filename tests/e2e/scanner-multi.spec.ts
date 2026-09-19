import { writeFile } from "node:fs/promises";
import type { APIResponse, Page, TestInfo } from "@playwright/test";

import { qrCodeMatrix } from "../../src/react/print/qrCode";
import { ensureTestInfrastructure, expect, openNavigationEntry, test } from "./fixtures";

type CameraCode = { code: string; modules: boolean[][]; x: number; y: number; cell: number };

function cameraCodes(codes: string[]): CameraCode[] {
  return codes.map((code, index) => ({
    code,
    modules: qrCodeMatrix(`https://example.test/c/${code}`),
    x: index % 2 ? 535 : 65,
    y: codes.length <= 2 ? 230 : index < 2 ? 40 : 400,
    cell: 7,
  }));
}

/** Capture actual QR pixels, then supply a blank frame on subsequent camera starts. */
async function installCamera(page: Page, codes: CameraCode[]) {
  return page.evaluateHandle((entries) => {
    const tracks: MediaStreamTrack[] = [];
    const canvases: HTMLCanvasElement[] = [];
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => {
        const canvas = document.createElement("canvas");
        canvas.width = 960;
        canvas.height = 720;
        canvases.push(canvas);
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#e2e8ef";
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (!tracks.length) {
          entries.forEach(({ modules, x, y, cell }) => {
            const size = (modules.length + 8) * cell;
            context.fillStyle = "white";
            context.fillRect(x, y, size, size);
            context.fillStyle = "black";
            modules.forEach((row, rowIndex) =>
              row.forEach((dark, colIndex) => {
                if (dark) context.fillRect(x + (colIndex + 4) * cell, y + (rowIndex + 4) * cell, cell, cell);
              }),
            );
          });
        }
        const stream = canvas.captureStream(10);
        tracks.push(stream.getVideoTracks()[0]);
        return Promise.resolve(stream);
      },
    });
    return { tracks, canvases };
  }, codes);
}

async function signIn(page: Page) {
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
}

async function successfulJson(response: APIResponse) {
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBe(true);
  return body;
}

async function selectedNumber(page: Page, code: string) {
  const option = page.getByRole("button", { name: new RegExp(`^查看二维码 \\d+：${code}$`) });
  const label = await option.getAttribute("aria-label");
  expect(label).toBeTruthy();
  return label!.match(/查看二维码 (\d+)：/)![1];
}

async function captureChoices(page: Page, testInfo: TestInfo, entries: CameraCode[]) {
  const picker = page.locator(".scanner-candidate-picker");
  const frame = page.locator(".scanner-candidate-frame");
  for (const [width, height] of [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(picker.locator(".scanner-candidate-hit")).toHaveCount(entries.length);
    await frame.scrollIntoViewIfNeeded();
    const geometry = await picker.evaluate((element) => {
      const container = element.querySelector<HTMLElement>(".scanner-candidate-frame")!;
      const image = container.querySelector<HTMLImageElement>("img")!;
      const rect = container.getBoundingClientRect();
      return {
        frame: rect.toJSON(),
        image: { width: image.naturalWidth, height: image.naturalHeight, objectFit: getComputedStyle(image).objectFit },
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        hits: [...element.querySelectorAll<HTMLElement>(".scanner-candidate-hit")].map((button) => ({
          label: button.getAttribute("aria-label"),
          rect: button.getBoundingClientRect().toJSON(),
          position: getComputedStyle(button).position,
          pointerEvents: getComputedStyle(button).pointerEvents,
          transform: getComputedStyle(button).transform,
        })),
        options: [...element.querySelectorAll<HTMLElement>("button[aria-label^='查看二维码']")].map((button) => ({
          label: button.getAttribute("aria-label"),
          rect: button.getBoundingClientRect().toJSON(),
          height: getComputedStyle(button).height,
        })),
      };
    });
    expect(geometry.image).toMatchObject({ width: 960, height: 720, objectFit: "contain" });
    expect(geometry.pageOverflow).toBe(false);
    expect(geometry.frame.x).toBeGreaterThanOrEqual(0);
    expect(geometry.frame.right).toBeLessThanOrEqual(width + 1);
    const scale = Math.min(geometry.frame.width / 960, geometry.frame.height / 720);
    const offsetX = geometry.frame.x + (geometry.frame.width - 960 * scale) / 2;
    const offsetY = geometry.frame.y + (geometry.frame.height - 720 * scale) / 2;
    const centers = entries.map(({ modules, x, y, cell }) => ({
      x: offsetX + (x + ((modules.length + 8) * cell) / 2) * scale,
      y: offsetY + (y + ((modules.length + 8) * cell) / 2) * scale,
    }));
    const matched = new Set<number>();
    geometry.hits.forEach(({ rect, pointerEvents, label }, position) => {
      expect(pointerEvents).not.toBe("none");
      expect(rect.x).toBeGreaterThanOrEqual(geometry.frame.x);
      expect(rect.right).toBeLessThanOrEqual(geometry.frame.right + 1);
      const index = centers.findIndex(
        (center) => Math.hypot(center.x - rect.x - rect.width / 2, center.y - rect.y - rect.height / 2) < 3,
      );
      expect(index, JSON.stringify({ rect, centers })).toBeGreaterThanOrEqual(0);
      expect(index).toBe(position);
      expect(label).toBe(`选择二维码 ${position + 1}`);
      matched.add(index);
    });
    expect(matched.size).toBe(entries.length);
    geometry.options.forEach(({ rect, height: controlHeight }) => {
      expect(controlHeight).toBe("32px");
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(width + 1);
    });
    const body = JSON.stringify(geometry, null, 2);
    await writeFile(testInfo.outputPath(`multi-qr-${width}-geometry.json`), body);
    await testInfo.attach(`multi-qr-${width}-geometry`, { body, contentType: "application/json" });
    await page.screenshot({ path: testInfo.outputPath(`multi-qr-${width}.png`), animations: "disabled" });
  }
}

test("multiple camera codes wait for a choice and resolve only the selected real cage card", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await signIn(page);
  await ensureTestInfrastructure(page);
  const records: Array<{ qrId: string; batchNo: string; status: string }> = [];
  for (const [index, status] of ["已打印", "待进驻"].entries()) {
    const id = `scanner-multi-${index}-${testInfo.retry}`;
    const batchNo = `多码选择真实批次-${index}-${testInfo.retry}`;
    const created = await successfulJson(
      await page.request.post("/api/intake-batches", {
        data: {
          item: {
            id,
            batchNo,
            status: "pending_print",
            receiverName: "多码扫描接收人",
            iacuc: `Z202609121${index}`,
            supplier: "多码测试供应商",
            pi: `多码项目负责人${index}`,
            owner: `多码实验负责人${index}`,
            roomName: "8014",
            intakeDate: "2026-09-12",
            endDate: "2026-10-12",
            quantity: 5,
            suggestedAnimalsPerCage: 5,
            finalCardCount: 1,
            species: "mouse",
            strainStandard: "C57BL/6J",
            cards: [],
          },
        },
      }),
    );
    await successfulJson(await page.request.post("/api/intake-batches/mark-printed", { data: { ids: [id] } }));
    if (index === 1) {
      await successfulJson(
        await page.request.post(`/api/intake-batches/${id}/confirm-receipt`, {
          data: { actualReceiptDate: "2026-09-12", cardCount: 1 },
        }),
      );
    }
    records.push({ qrId: created.item.cards[0].qrId, batchNo, status });
  }
  await openNavigationEntry(page, "笼卡管理", "二维码扫描");
  const requested: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/public/cage-card/")) requested.push(request.url().split("/").at(-1)!);
  });
  const camera = await installCamera(page, cameraCodes(records.map(({ qrId }) => qrId)));
  await page.getByRole("button", { name: "启动摄像头", exact: true }).click();
  const picker = page.locator(".scanner-candidate-picker");
  await expect(picker).toBeVisible();
  await expect(picker.locator(".scanner-candidate-hit")).toHaveCount(2);
  expect(requested).toEqual([]);
  expect(await camera.evaluate(({ tracks }) => tracks[0].readyState)).toBe("ended");
  const frozenSource = await picker.locator(".scanner-candidate-frame img").getAttribute("src");

  const first = records[0];
  const firstNumber = await selectedNumber(page, first.qrId);
  await page.getByRole("button", { name: `选择二维码 ${firstNumber}`, exact: true }).click();
  const result = page.locator(".scanner-result-card");
  await expect(result.locator(".ant-card-head-title")).toHaveText(first.batchNo);
  await expect(result.locator(".ant-tag")).toHaveText(first.status);
  await expect(page.locator(".scanner-capture")).toHaveAttribute("data-phase", "aligned");
  expect(requested).toEqual([first.qrId]);

  await page.getByRole("button", { name: "重新选择二维码", exact: true }).click();
  await expect(picker).toBeVisible();
  expect(await picker.locator(".scanner-candidate-frame img").getAttribute("src")).toBe(frozenSource);
  expect(requested).toEqual([first.qrId]);
  const second = records[1];
  const secondNumber = await selectedNumber(page, second.qrId);
  const keyboardChoice = page.getByRole("button", { name: `查看二维码 ${secondNumber}：${second.qrId}`, exact: true });
  await keyboardChoice.focus();
  await expect(keyboardChoice).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "继续扫码", exact: true })).toBeFocused();
  await expect(result.locator(".ant-card-head-title")).toHaveText(second.batchNo);
  await expect(result.locator(".ant-tag")).toHaveText(second.status);
  expect(requested).toEqual([first.qrId, second.qrId]);
  expect(await camera.evaluate(({ tracks }) => tracks.length)).toBe(1);
  await testInfo.attach("multi-qr-selected-real-records", {
    body: JSON.stringify({ records, requested }, null, 2),
    contentType: "application/json",
  });
});

test("four frame locations including repeated content remain selectable across viewport and motion settings", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await signIn(page);
  await openNavigationEntry(page, "笼卡管理", "二维码扫描");
  await page.emulateMedia({ reducedMotion: "reduce" });
  let requests = 0;
  await page.route("**/api/public/cage-card/**", (route) => {
    requests += 1;
    const qrId = route.request().url().split("/").at(-1)!;
    return route.fulfill({ json: { item: { qrId, batchNo: `选择结果-${qrId}`, statusLabel: "已接收" } } });
  });
  const entries = cameraCodes(["AB12", "CD34", "AB12", "EF56"]);
  await installCamera(page, entries);
  await page.getByRole("button", { name: "启动摄像头", exact: true }).click();
  const picker = page.locator(".scanner-candidate-picker");
  await expect(picker.locator(".scanner-candidate-hit")).toHaveCount(4);
  await expect(page.getByRole("button", { name: /^查看二维码 \d+：AB12$/ })).toHaveCount(2);
  expect(
    await picker
      .locator(".scanner-candidate-options button")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
  ).toEqual(["查看二维码 1：AB12", "查看二维码 2：CD34", "查看二维码 3：AB12", "查看二维码 4：EF56"]);
  expect(requests).toBe(0);
  await captureChoices(page, testInfo, entries);
  const choice = page.getByRole("button", { name: /^查看二维码 \d+：EF56$/ });
  await choice.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "继续扫码", exact: true })).toBeFocused();
  await expect(page.locator(".scanner-capture")).toHaveAttribute("data-phase", "aligned");
  expect(await page.locator(".scanner-qr-plane").evaluate((element) => element.getAnimations().length)).toBe(0);
  await expect(page.locator(".scanner-result-card")).toContainText("选择结果-EF56");
  expect(requests).toBe(1);
});

test.describe("touch multi-code selection", () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  test("touch choices, camera restart and leaving do not resurrect the frozen candidates", async ({ page }) => {
    await signIn(page);
    await openNavigationEntry(page, "笼卡管理", "二维码扫描");
    let requests = 0;
    await page.route("**/api/public/cage-card/**", (route) => {
      requests += 1;
      return route.fulfill({ json: { item: { qrId: "CD34", batchNo: "触屏选择结果", statusLabel: "已接收" } } });
    });
    const camera = await installCamera(page, cameraCodes(["AB12", "CD34"]));
    await page.getByRole("button", { name: "启动摄像头", exact: true }).tap();
    const picker = page.locator(".scanner-candidate-picker");
    await expect(picker.locator(".scanner-candidate-hit")).toHaveCount(2);
    expect(requests).toBe(0);
    const number = await selectedNumber(page, "CD34");
    await page.getByRole("button", { name: `选择二维码 ${number}`, exact: true }).tap();
    await expect(page.getByLabel("笼卡识别码")).toHaveValue("CD34");
    await expect(page.locator(".scanner-result-card")).toContainText("触屏选择结果");
    expect(requests).toBe(1);
    await page.getByRole("button", { name: "重新选择二维码", exact: true }).tap();
    await expect(picker).toBeVisible();
    await page.getByRole("button", { name: "继续扫码", exact: true }).tap();
    await expect(picker).toHaveCount(0);
    await expect(page.getByRole("button", { name: "停止扫码", exact: true })).toBeEnabled();
    expect(await camera.evaluate(({ tracks }) => tracks.map((track) => track.readyState))).toEqual(["ended", "live"]);
    await page.getByRole("button", { name: "返回笼卡管理", exact: true }).tap();
    await expect(page.getByLabel("笼卡扫码画面")).toHaveCount(0);
    expect(await camera.evaluate(({ tracks }) => tracks.every((track) => track.readyState === "ended"))).toBe(true);
    await openNavigationEntry(page, "笼卡管理", "二维码扫描");
    await expect(page.getByRole("button", { name: "启动摄像头", exact: true })).toBeEnabled();
    await expect(picker).toHaveCount(0);
    expect(requests).toBe(1);
  });
});
