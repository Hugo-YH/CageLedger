import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { ensureTestInfrastructure, expect, openNavigationEntry, test } from "./fixtures";

test("reception notes export Word by inclusive dates without selecting or changing batches", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60_000);
  expect((await request.get("/api/intake-batches/summary.docx?startDate=2026-10-12&endDate=2026-10-13")).status()).toBe(
    401,
  );
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("admin123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "实验动物笼位管理与计费系统", exact: true })).toBeVisible();
  await ensureTestInfrastructure(page);
  const ids = ["summary-e2e-start", "summary-e2e-end", "summary-e2e-outside"];
  try {
    for (const [index, id] of ids.entries()) {
      const response = await page.request.post("/api/intake-batches", {
        data: {
          item: {
            id,
            batchNo: id,
            iacuc: "Z2026001",
            purchaseOrderNo: `PO-${index}`,
            supplier: "导出测试供应单位",
            pi: "导出项目负责人",
            owner: "预约人员",
            roomName: "8014",
            intakeDate: `2026-10-${12 + index}`,
            endDate: "2026-11-12",
            quantity: 6,
            finalCardCount: 2,
            species: "mouse",
            strainRaw: "ICR",
            status: "pending_print",
            rawMessage: "8周龄，20克，下午送达",
            receiverName: "系统管理员",
            cards: [],
          },
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
    }
    const before = await Promise.all(
      ids.map(async (id) => (await page.request.get(`/api/intake-batches/${id}`)).json()),
    );
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    const trigger = page.getByRole("button", { name: "导出汇总", exact: true });
    await expect(trigger).toBeEnabled();
    await trigger.click();
    const modal = page.getByRole("dialog", { name: "接收汇总" });
    await expect(modal).toBeVisible();
    const setDate = async (label: string, value: string) => {
      const input = modal.getByRole("textbox", { name: label, exact: true });
      await input.fill(value);
      await input.press("Enter");
      await input.press("Tab");
    };
    await setDate("开始日期", "2026-10-13");
    await setDate("结束日期", "2026-10-12");
    await expect(modal.getByRole("button", { name: "导出 Word", exact: true })).toBeDisabled();
    await expect(modal.getByText("结束日期不能早于开始日期")).toBeVisible();
    await setDate("开始日期", "2026-10-12");
    await setDate("结束日期", "2026-10-13");
    await modal.getByText("接收汇总", { exact: true }).click();
    await expect(page.locator(".ant-picker-dropdown:visible")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("summary-dialog.png") });
    const downloadPromise = page.waitForEvent("download");
    await modal.getByRole("button", { name: "导出 Word", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("接收汇总_2026-10-12_2026-10-13.docx");
    await download.saveAs(testInfo.outputPath("reception-notes.docx"));
    expect((await readFile(testInfo.outputPath("reception-notes.docx"))).subarray(0, 2).toString()).toBe("PK");
    const content = execFileSync(
      process.execPath,
      [
        "scripts/run_python.mjs",
        "-c",
        "import sys,zipfile,xml.etree.ElementTree as ET; z=zipfile.ZipFile(sys.argv[1]); print('\\n'.join(ET.fromstring(z.read('word/document.xml')).itertext()))",
        testInfo.outputPath("reception-notes.docx"),
      ],
      { encoding: "utf8" },
    );
    expect(content).toContain("共 2 批");
    expect(content).toContain("summary-e2e-start");
    expect(content).toContain("summary-e2e-end");
    expect(content).not.toContain("summary-e2e-outside");
    expect(content).toContain("【未打印】");
    expect(content).not.toContain("预约原文：");
    expect(content).not.toContain("签收：");
    await expect(modal.getByRole("status")).toContainText("已下载");
    const after = await Promise.all(
      ids.map(async (id) => (await page.request.get(`/api/intake-batches/${id}`)).json()),
    );
    expect(after).toEqual(before);
    await setDate("开始日期", "2030-01-01");
    await setDate("结束日期", "2030-01-02");
    await modal.getByRole("button", { name: "导出 Word", exact: true }).click();
    await expect(modal.getByRole("alert")).toContainText("没有预约接收批次");
    await setDate("开始日期", "2026-10-12");
    await setDate("结束日期", "2026-10-13");
    const retry = page.waitForEvent("download");
    await modal.getByRole("button", { name: "导出 Word", exact: true }).click();
    await retry;
    await modal.getByRole("button", { name: "取消", exact: true }).click();
    await expect(modal).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.click();
    await expect(modal.getByRole("button", { name: "导出 Word", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
  } finally {
    for (const id of ids) await page.request.delete(`/api/intake-batches/${id}`);
  }
});
