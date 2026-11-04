import { execFileSync } from "node:child_process";
import { expect, openNavigationEntry, test } from "./fixtures";

test("ordinary cage cards use current researcher phones without writing them into the batch", async ({
  page,
  context,
}, info) => {
  const health = await (await page.request.get("/api/health")).json();
  expect(health.database).toContain("cageledger-e2e-");
  expect((await page.request.post("/api/auth/login", { data: { username: "admin", password: "admin123" } })).ok()).toBe(
    true,
  );
  const suffix = Date.now();
  const id = `batch-contact-print-${suffix}`;
  const batchNo = `（Z2026001）2026110401`;
  const names = [`打印甲${suffix}`, `打印乙${suffix}`];
  const content = execFileSync(
    process.execPath,
    [
      "scripts/run_python.mjs",
      "-c",
      [
        "import json,sys,base64",
        "from io import BytesIO",
        "from openpyxl import Workbook",
        "w=Workbook();s=w.active;s.append(['姓名','账号','手机','座机'])",
        "for row in json.load(sys.stdin): s.append(row)",
        "b=BytesIO();w.save(b);w.close();print(base64.b64encode(b.getvalue()).decode())",
      ].join("\n"),
    ],
    {
      input: JSON.stringify([
        [names[0], `print-a-${suffix}`, "13800000001", "020-11111111"],
        [names[1], `print-b-${suffix}`, null, "020-22222222"],
      ]),
    },
  )
    .toString()
    .trim();
  const file = { filename: "笼卡电话测试.xlsx", data: content };
  const preview = await page.request.post("/api/researchers/import/preview", { data: file });
  expect(preview.ok(), await preview.text()).toBe(true);
  const imported = await page.request.post("/api/researchers/import", {
    data: { ...file, confirmationToken: (await preview.json()).confirmationToken, requestId: `print-${suffix}` },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
  const room = await page.request.post("/api/rooms", {
    data: {
      item: {
        id: `room-print-8101`,
        name: "8101",
        area: "E2E",
        roomManager: "管理员",
        facility: "zhujiang",
        defaultSpecies: "mouse",
        defaultBillingItem: "mouse_standard",
        defaultCustomerType: "internal",
        defaultAnimalCount: 5,
      },
    },
  });
  expect(room.ok(), await room.text()).toBe(true);
  const created = await page.request.post("/api/intake-batches", {
    data: {
      item: {
        id,
        batchNo,
        iacuc: "Z2026001",
        supplier: `打印供应商${suffix}`,
        strainStandard: "C57BL/6J",
        pi: "项目负责人",
        owner: names.join("、"),
        specification: "6–8周龄，20–25g",
        roomName: "8101",
        receiverName: "接收人员",
        vetPhone: "13999999999",
        status: "pending_print",
        intakeDate: "2026-11-04",
        husbandryDays: 30,
        endDate: "2026-12-04",
        quantity: 5,
        finalCardCount: 1,
        suggestedAnimalsPerCage: 5,
        suggestedCardCount: 1,
        species: "mouse",
        cards: [],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const saved = (await created.json()).item;
  await context.addInitScript(() => {
    window.print = () => {};
    window.focus = () => {};
  });
  try {
    await page.goto("/app");
    await openNavigationEntry(page, "笼卡管理", "待接收批次");
    const row = page.locator(`tr[data-row-key="${id}"]`);
    await row.getByRole("checkbox").check();
    const print = async () => {
      await page.getByRole("button", { name: "打印笼卡", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "补齐空白笼卡", exact: true });
      await expect(dialog).toBeVisible();
      const popupPromise = page.waitForEvent("popup");
      await dialog.getByRole("button", { name: "直接打印", exact: true }).click();
      const popup = await popupPromise;
      await expect(popup.locator(".standard-card")).toHaveCount(1);
      return popup;
    };
    let popup = await print();
    const phoneCell = popup.locator(".standard-card tr").nth(3).locator("td").nth(1);
    await expect(phoneCell).toHaveText("13800000001 / 020-22222222");
    await expect(popup.locator(".standard-card tr").nth(2).locator("td").nth(3)).toHaveText("6–8周龄，20–25g");
    await expect(popup.locator(".standard-card")).not.toContainText("13999999999");
    await popup.screenshot({ path: info.outputPath("ordinary-card-current-contacts.png") });
    await popup.close();
    await expect(row).toContainText("已打印");
    const people = await (await page.request.get(`/api/researchers?q=${encodeURIComponent(names[0])}`)).json();
    const person = people.items[0];
    const updated = await page.request.put(`/api/researchers/${person.id}`, {
      data: { item: { mobile: "13800000003" }, expectedUpdatedAt: person.updatedAt },
    });
    expect(updated.ok(), await updated.text()).toBe(true);
    if (!(await row.getByRole("checkbox").isChecked())) await row.getByRole("checkbox").check();
    popup = await print();
    await expect(popup.locator(".standard-card tr").nth(3).locator("td").nth(1)).toHaveText(
      "13800000003 / 020-22222222",
    );
    await popup.close();
    const after = await (await page.request.get(`/api/intake-batches/${id}`)).json();
    expect(after.item.owner).toBe(saved.owner);
    expect(after.item.vetPhone).toBe(saved.vetPhone);
    expect(after.item.cards.map((card: { qrId: string }) => card.qrId)).toEqual(
      saved.cards.map((card: { qrId: string }) => card.qrId),
    );
    expect(after.item).not.toHaveProperty("contactPhones");
  } finally {
    expect((await page.request.delete(`/api/intake-batches/${id}`)).ok()).toBe(true);
  }
});
