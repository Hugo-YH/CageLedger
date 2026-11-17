import type { Page, Route } from "@playwright/test";
import {
  ensureTestInfrastructure,
  expect,
  openIntakeEntry,
  openNavigationEntry,
  openSettingsView,
  selectAntOptionByKeyboard,
  test,
} from "./fixtures";

async function discard(page: Page) {
  await page.getByRole("button", { name: "放弃修改并离开", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  const health = await (await page.request.get("/api/health")).json();
  expect(health.database).toContain("cageledger-e2e-");
  expect((await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } })).ok()).toBe(
    true,
  );
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
});

test("appointment drafts require explicit discard and direct-sampling errors focus the quantity", async ({
  page,
}, info) => {
  await openIntakeEntry(page);
  const message = page.getByLabel("预约消息", { exact: true });
  await message.fill("尚未识别的预约草稿");
  await page.getByRole("button", { name: "新建批次", exact: true }).click();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(message).toHaveValue("尚未识别的预约草稿");
  await page.getByRole("button", { name: "新建批次", exact: true }).click();
  await discard(page);
  await expect(message).toHaveValue("");
  await selectAntOptionByKeyboard(page, page.getByRole("combobox", { name: "接收用途", exact: true }));
  await expect(page.getByRole("heading", { name: "直接取材预约", exact: true })).toBeVisible();
  for (const [label, value] of [
    ["供应商", "测试供应商"],
    ["IACUC 编号", "Z2026001"],
    ["项目负责人", "测试负责人"],
    ["实验负责人/助手", "测试实验负责人"],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  const quantity = page.getByLabel("数量（只）", { exact: true });
  await quantity.fill("0");
  await page.getByRole("button", { name: "保存待接收批次", exact: true }).click();
  await expect(quantity).toHaveAttribute("aria-invalid", "true");
  await expect(quantity).toBeFocused();
  await expect(page.getByText("直接取材数量须为大于 0 的整数", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("intake-field-validation.png"), animations: "disabled" });
  await quantity.fill("2");
  await expect(quantity).toHaveAttribute("aria-invalid", "false");
  await openNavigationEntry(page, "笼卡管理", "待接收批次");
  await discard(page);
  await expect(page.getByRole("region", { name: "待接收批次列表", exact: true })).toBeVisible();
  await openIntakeEntry(page);
  await expect(message).toHaveValue("");
  await expect(page.getByLabel("数量（只）", { exact: true })).toHaveValue("");
});

test("inspection photos have a visible picker, thumbnail preview and mobile layout", async ({ page }, info) => {
  await openNavigationEntry(page, "动物管理", "动物巡检");
  await selectAntOptionByKeyboard(page, page.getByRole("combobox", { name: "设施", exact: true }));
  await page.getByRole("combobox", { name: "饲养间", exact: true }).click();
  await page.getByText("8014", { exact: true }).last().click();
  const section = page.locator('.inspection-module-card[data-module="basicAssessment"] .inspection-section').first();
  await section.locator(".ant-collapse-header").click();
  await expect(section.locator(".ant-collapse-panel")).not.toHaveClass(/ant-motion-collapse/);
  await section.locator(".inspection-node").first().getByRole("button", { name: "异常", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "选择现场照片", exact: true })).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "现场.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(dialog.getByText("现场.png", { exact: true })).toBeVisible();
  await dialog.getByText("现场.png", { exact: true }).click();
  await expect(page.locator(".ant-image-preview-mask")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-image-preview-mask")).toBeHidden();
  await expect(dialog).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [1180, 800],
    [760, 900],
    [844, 390],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    const confirm = dialog.getByRole("button", { name: "确认异常", exact: true });
    await expect(confirm).toBeVisible();
    const bounds = await confirm.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const geometry = await dialog.evaluate((element) => {
      const container = element.querySelector<HTMLElement>(".ant-modal-container")!;
      const body = element.querySelector<HTMLElement>(".ant-modal-body")!;
      return {
        container: {
          display: getComputedStyle(container).display,
          maxHeight: getComputedStyle(container).maxHeight,
          padding: getComputedStyle(container).padding,
        },
        body: {
          overflow: getComputedStyle(body).overflowY,
          minHeight: getComputedStyle(body).minHeight,
          height: body.getBoundingClientRect().height,
        },
      };
    });
    expect(geometry.container.display).toBe("flex");
    expect(geometry.body.overflow).toBe("auto");
    await info.attach(`inspection-photo-layout-${width}x${height}`, {
      body: JSON.stringify(geometry),
      contentType: "application/json",
    });
    await page.screenshot({
      path: info.outputPath(`inspection-photo-picker-${width}x${height}.png`),
      animations: "disabled",
    });
  }
});

test("facility submission protects every close path and keeps the draft after failure", async ({ page }, info) => {
  await openSettingsView(page, "房间管理");
  await page.getByRole("button", { name: "新增饲养间", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^(新增|编辑)饲养间$/ });
  const name = dialog.getByLabel("饲养间名称", { exact: true });
  await name.fill("设施编辑保留草稿");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(name).toHaveValue("设施编辑保留草稿");
  let pending: Route | undefined;
  await page.route("**/api/infrastructure", (route) => {
    pending = route;
  });
  await dialog.getByRole("button", { name: "保存饲养间", exact: true }).click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(name).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await pending!.fulfill({ status: 503, json: { error: "测试保存失败，请重试" } });
  await expect(dialog.getByRole("alert")).toContainText("测试保存失败");
  await expect(name).toHaveValue("设施编辑保留草稿");
  await expect(name).toBeEnabled();
  await page.screenshot({ path: info.outputPath("facility-save-recovery.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await discard(page);
  await expect(dialog).toBeHidden();
});

test("manual quarantine source errors stay with their inputs and focus the first missing field", async ({ page }) => {
  await openNavigationEntry(page, "检疫管理", "检疫批次");
  await page.getByRole("tab", { name: "检疫批次列表", exact: true }).click();
  await page.getByRole("button", { name: "新建检疫批次", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建检疫批次", exact: true });
  await dialog.getByText("手工补充来源（哨兵鼠等）", { exact: true }).click();
  await dialog.getByRole("button", { name: "添加手工来源", exact: true }).click();
  const supplier = dialog.getByRole("combobox", { name: "手工供应商", exact: true });
  await expect(supplier).toHaveAttribute("aria-invalid", "true");
  await expect(supplier).toBeFocused();
  await supplier.fill("手工来源供应商");
  await dialog.getByRole("button", { name: "添加手工来源", exact: true }).click();
  await expect(dialog.getByText("请填写手工来源供应商", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("已添加手工来源", { exact: true })).toBeVisible();
});

test("applied intake filters can be cleared and identifiers expose a keyboard-accessible copy action", async ({
  page,
}, info) => {
  const id = `antd-interaction-${Date.now()}`;
  const batchNo = `E2E-ANTD-${Date.now()}`;
  const pi = `筛选负责人-${Date.now()}`;
  const response = await page.request.post("/api/intake-batches", {
    data: {
      item: {
        id,
        batchNo,
        receiverName: "系统管理员",
        status: "pending_print",
        intakePurpose: "housing",
        iacuc: "Z2026001",
        supplier: "测试供应商",
        strainStandard: "BALB/cJGpt",
        pi,
        owner: "测试实验负责人",
        roomName: "8014",
        intakeDate: "",
        quantity: 5,
        suggestedCardCount: 1,
        finalCardCount: 1,
        species: "mouse",
        cards: [],
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  try {
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    await page.getByRole("button", { name: "筛选项目负责人", exact: true }).click();
    const panel = page.getByRole("group", { name: "筛选项目负责人选项", exact: true });
    await panel.getByRole("searchbox").fill(pi);
    await panel.getByRole("checkbox", { name: new RegExp(pi) }).check();
    const filters = page.locator('[aria-label="当前筛选条件"]');
    await expect(filters).toContainText(pi.slice(0, 20));
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "完成", exact: true }).click();
    await expect(page.getByRole("button", { name: "筛选项目负责人", exact: true })).toBeFocused();
    const row = page.getByRole("row").filter({ hasText: batchNo });
    const strain = row.getByRole("button", { name: "查看完整内容：BALB/cJGpt", exact: true });
    const alignment = await strain.evaluate((element) => {
      const cell = element.closest("td")!;
      const range = document.createRange();
      range.selectNodeContents(element);
      const cellStyle = getComputedStyle(cell);
      return {
        textLeft: range.getBoundingClientRect().left,
        contentLeft: cell.getBoundingClientRect().left + cell.clientLeft + parseFloat(cellStyle.paddingLeft),
        textHeight: element.getBoundingClientRect().height,
        lineHeight: parseFloat(cellStyle.lineHeight),
      };
    });
    expect(Math.abs(alignment.textLeft - alignment.contentLeft)).toBeLessThan(1);
    expect(Math.abs(alignment.textHeight - alignment.lineHeight)).toBeLessThan(1);
    await strain.focus();
    await strain.press("Enter");
    await expect(strain).toHaveAttribute("aria-expanded", "true");
    await strain.press("Escape");
    await expect(strain).toHaveAttribute("aria-expanded", "false");
    await page.screenshot({ path: info.outputPath("intake-strain-alignment.png"), animations: "disabled" });
    const detail = row.getByRole("button", { name: `查看完整内容：${batchNo}`, exact: true });
    await detail.focus();
    await detail.press("Enter");
    await page.mouse.move(0, 0);
    await expect(page.getByRole("button", { name: "复制编号", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("intake-filter-and-copy.png"), animations: "disabled" });
    await detail.press("Escape");
    await filters.getByRole("button", { name: "清空筛选", exact: true }).click();
    await expect(filters).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/intake-batches/${id}`);
  }
});
