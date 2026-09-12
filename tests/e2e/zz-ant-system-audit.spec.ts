import { captureUiAudit } from "./uiAudit";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { expect, openNavigationEntry, test } from "./fixtures";

const entries = [
  ["", "总览"],
  ["笼卡管理", "预约消息识别"],
  ["笼卡管理", "待接收批次"],
  ["笼卡管理", "二维码扫描"],
  ["检疫管理", "检疫批次"],
  ["检疫管理", "寄生虫检测"],
  ["检疫管理", "ELISA检测"],
  ["检疫管理", "PCR检测"],
  ["检疫管理", "检疫报告"],
  ["", "笼位管理"],
  ["动物管理", "动物巡检"],
  ["动物管理", "异常处置"],
  ["动物管理", "巡检记录"],
  ["动物管理", "巡检标准"],
  ["饲养费管理", "录入数量统计表"],
  ["饲养费管理", "已保存数量统计表"],
  ["饲养费管理", "结算管理"],
  ["饲养费管理", "单据跟踪"],
  ["饲养费管理", "汇总导出"],
  ["系统设置", "房间管理"],
  ["系统设置", "账号管理"],
  ["系统设置", "数据管理"],
  ["系统设置", "关于系统"],
  ["系统设置", "操作日志"],
];

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1180, height: 900 },
  { width: 760, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`Ant system page inventory ${viewport.width}`, async ({ page }, testInfo) => {
    test.setTimeout(180000);
    page.setDefaultTimeout(10000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/app");
    await page.getByLabel("用户名", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("admin123");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByLabel("用户名", { exact: true })).toBeHidden();
    for (const [group, label] of entries) {
      if (viewport.width <= 760) {
        if (label === "总览" || label === "笼位管理") {
          await page.getByRole("tab", { name: label === "总览" ? "总览" : "笼位", exact: true }).click();
        } else {
          await page.getByRole("tab", { name: "更多", exact: true }).click();
          await page.locator(".ant-mobile-navigation-sheet").getByText(label, { exact: true }).click();
          await expect(page.locator(".ant-mobile-navigation-sheet")).toBeHidden();
        }
      } else if (group) {
        await openNavigationEntry(page, group, label);
      } else {
        await page
          .locator(".ant-main-menu")
          .getByRole("menuitem", { name: new RegExp(label) })
          .click();
      }
      await expect(page.locator('[data-ui="page-skeleton"]')).toHaveCount(0);
      const geometry = await page.evaluate(() => {
        const main = document.querySelector("main.workspace") || document.querySelector("main");
        const controls = [
          ...(main?.querySelectorAll<HTMLElement>(
            ".ant-btn, .ant-select, .ant-picker, .ant-input-affix-wrapper, .ant-input-number, input.ant-input, .adm-button",
          ) ?? []),
        ]
          .filter((el) => el.getClientRects().length && !el.closest('[aria-hidden="true"]'))
          .map((el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return {
              label: el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder"),
              className: el.className,
              width: rect.width,
              height: rect.height,
              font: style.fontSize,
              radius: style.borderRadius,
              color: style.color,
              background: style.backgroundColor,
              weight: style.fontWeight,
              x: rect.x,
              y: rect.y,
            };
          });
        const toolbars = [...document.querySelectorAll<HTMLElement>('[data-ui="workspace-toolbar"]')].map((el) => {
          const style = getComputedStyle(el);
          return {
            display: style.display,
            position: style.position,
            gap: style.gap,
            minWidth: style.minWidth,
            zIndex: style.zIndex,
            overflow: style.overflow,
            rect: el.getBoundingClientRect().toJSON(),
          };
        });
        return {
          controls,
          toolbars,
          selectionLabels: [...document.querySelectorAll<HTMLElement>(".app-command-bar-context .ant-typography")]
            .filter((el) => el.textContent?.startsWith("已选"))
            .map((el) => ({
              text: el.textContent,
              height: el.getBoundingClientRect().height,
              lineHeight: parseFloat(getComputedStyle(el).lineHeight),
            })),
          mobileHeaderGap: (() => {
            const shell = document.querySelector('[data-ui="mobile-page"]');
            const header = shell?.querySelector(".adm-nav-bar");
            const body = shell?.querySelector(".ant-mobile-page-body");
            return header && body ? body.getBoundingClientRect().top - header.getBoundingClientRect().bottom : null;
          })(),
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          workspaceOverflow: !!main && main.scrollWidth > main.clientWidth + 1,
          viewport: { width: innerWidth, height: innerHeight },
        };
      });
      await testInfo.attach(`${label}-geometry`, { body: JSON.stringify(geometry), contentType: "application/json" });
      await writeFile(testInfo.outputPath(`${label}-computed-style.json`), JSON.stringify(geometry, null, 2));
      await page.screenshot({ path: testInfo.outputPath(`${label}.png`), animations: "disabled" });
      for (const selection of geometry.selectionLabels)
        expect
          .soft(selection.height, `${label} ${selection.text} must stay readable`)
          .toBeLessThanOrEqual(selection.lineHeight + 1);
      expect.soft(geometry.pageOverflow, `${label} page overflow`).toBe(false);
      expect.soft(geometry.workspaceOverflow, `${label} workspace overflow`).toBe(false);
      if (geometry.mobileHeaderGap !== null)
        expect.soft(geometry.mobileHeaderGap, `${label} navigation gap`).toBeLessThanOrEqual(24);
    }
  });
}

test("quarantine detail actions remain separated and reachable while scrolling", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeHidden();
  const batchId = randomUUID();
  const name = `UI-${batchId}`;
  const batchResponse = await page.request.post("/api/quarantine/batches", {
    data: {
      item: {
        id: batchId,
        name,
        sources: [
          { id: "a", supplier: "江苏集萃", species: "小鼠", pi: "张三", owner: "李四" },
          { id: "b", supplier: "广东药康", species: "小鼠", pi: "李五", owner: "赵六" },
        ],
      },
    },
  });
  expect(batchResponse.ok(), await batchResponse.text()).toBe(true);
  const recordResponse = await page.request.post("/api/quarantine/tests", {
    data: {
      item: {
        id: randomUUID(),
        batchId,
        method: "parasite",
        reportFormVersion: 2,
        reportMaterial: "皮毛、肠内容物",
        reportSpecimenState: "固体",
        samplingDate: "2026-09-02",
        testDate: "2026-09-03",
        samples: ["a", "b"].map((id, index) => ({
          id,
          number: String(index + 1),
          material: "皮毛、肠内容物",
          specimenState: "固体",
          sourceIds: [id],
          poolCount: 1,
          portionCount: 1,
        })),
        projects: ["体外寄生虫", "体内寄生虫"].map((name, index) => ({
          id: `p${index}`,
          name,
          sampleIds: ["a", "b"],
          results: { a: "negative", b: "negative" },
        })),
      },
    },
  });
  expect(recordResponse.ok(), await recordResponse.text()).toBe(true);
  await openNavigationEntry(page, "检疫管理", "寄生虫检测");
  await page.getByLabel("搜索检疫批次", { exact: true }).fill(name);
  await page.getByLabel("搜索检疫批次", { exact: true }).press("Enter");
  await page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "查看检测记录" }).click();
  await page.getByRole("tab", { name: "寄生虫检测 · 2026-09-03 · 草稿", exact: true }).click();
  await expect(page.getByRole("button", { name: "新建寄生虫检测记录", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "新建检测记录", exact: true })).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "复检供应商" })).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [1180, 900],
    [760, 900],
    [844, 390],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    const actions = page.getByRole("group", { name: "报告操作", exact: true });
    await actions.scrollIntoViewIfNeeded();
    await expect(actions).toHaveCSS("position", "relative");
    const metrics = await actions.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const next = el.nextElementSibling!.getBoundingClientRect();
      const controls = [...el.querySelectorAll<HTMLButtonElement>("button.ant-btn")]
        .filter((b) => b.getClientRects().length)
        .map((b) => {
          const r = b.getBoundingClientRect();
          const c = getComputedStyle(b);
          const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return {
            label: b.textContent,
            height: r.height,
            radius: c.borderRadius,
            font: c.fontSize,
            reachable: target === b || b.contains(target),
            x: r.x,
            right: r.right,
          };
        });
      return {
        gap: next.top - rect.bottom,
        controls,
        viewport: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(metrics.gap).toBeGreaterThanOrEqual(16);
    expect(metrics.overflow).toBe(false);
    for (const control of metrics.controls) {
      expect(control.height).toBe(32);
      expect(control.radius).toBe("6px");
      expect(control.font).toBe("14px");
      expect(control.reachable, `${width} ${control.label}`).toBe(true);
    }
    await testInfo.attach(`quarantine-actions-${width}`, {
      body: JSON.stringify(metrics),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath(`quarantine-detail-${width}.png`), animations: "disabled" });
    await expect(page.getByRole("combobox", { name: "复检供应商" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`quarantine-retest-${width}.png`), animations: "disabled" });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "编辑检测", exact: true }).click();
  await expect(page.getByLabel("采样日期", { exact: true })).toBeVisible();
  await captureUiAudit(page, testInfo, "parasite-report-editor");
});

test("public login keeps its fields and actions inside all supported viewports", async ({ page }, testInfo) => {
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
  await captureUiAudit(page, testInfo, "login");
});
