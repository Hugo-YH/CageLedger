import { expect, test as base, type Page } from "@playwright/test";

export { expect };

export const test = base.extend({
  page: async ({ page }, runPage) => {
    const runtimeErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (text.startsWith("Failed to load resource: the server responded with a status of")) return;
      runtimeErrors.push(`console: ${text}`);
    });
    page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));

    await runPage(page);

    expect(runtimeErrors, runtimeErrors.join("\n")).toEqual([]);
  },
});

export async function ensureTestInfrastructure(page: Page) {
  // Every create is idempotent at the API boundary. Running the full sequence
  // avoids observing another worker's partially-created room hierarchy.
  await page.request.post("/api/rooms", {
    data: {
      item: {
        id: "room-e2e-8014",
        name: "8014",
        area: "E2E",
        facility: "zhujiang",
        defaultSpecies: "mouse",
        defaultBillingItem: "mouse_standard",
        defaultCustomerType: "internal",
        defaultAnimalCount: 1,
      },
    },
  });
  await page.request.post("/api/racks", {
    data: {
      item: { id: "rack-e2e-8014-1", roomId: "room-e2e-8014", name: "8014 01 号笼架", index: 1, rows: 1, cols: 2 },
    },
  });
  for (const [id, col] of [
    ["slot-e2e-8014-a01", 1],
    ["slot-e2e-8014-a02", 2],
  ] as const) {
    await page.request.post("/api/cage-slots", {
      data: { item: { id, rackId: "rack-e2e-8014-1", row: 1, col, status: "empty" } },
    });
  }
  await page.reload();
}

export async function openSettingsView(page: Page, name: string) {
  await page.getByRole("button", { name: "系统设置", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}
