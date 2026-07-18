import { expect, test as base, type Locator, type Page } from "@playwright/test";

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
        roomManager: "E2E 房间管理员",
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
  const navigation = await openSettingsNavigation(page);
  await navigation.getByRole("button", { name: new RegExp(`^${escapeRegExp(name)}`) }).click();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function openIntakeEntry(page: Page) {
  await page.locator("nav.nav").getByRole("button", { name: "笼卡管理", exact: true }).click();
  const navigation = page.locator("#nav-intake");
  await expect(navigation).toBeVisible();
  await navigation.getByRole("button", { name: /^预约消息识别/ }).click();
}

export async function openQuantityEntry(page: Page) {
  const navigation = await openBillingNavigation(page);
  await navigation.getByRole("button", { name: /^数量统计表（录入）/ }).click();
}

export async function openSavedQuantitySheets(page: Page) {
  const navigation = await openBillingNavigation(page);
  await navigation.getByRole("button", { name: /^已保存数量统计表/ }).click();
}

export async function openWorkflowCenter(page: Page) {
  const navigation = await openBillingNavigation(page);
  await navigation.getByRole("button", { name: /^结算与报销台账/ }).click();
}

export async function openBillingNavigation(page: Page) {
  return openNavigationGroup(page, "饲养费管理", "#nav-billing");
}

export async function openSettingsNavigation(page: Page) {
  return openNavigationGroup(page, "系统设置", "#nav-settings");
}

async function openNavigationGroup(page: Page, label: string, desktopSelector: string): Promise<Locator> {
  const desktopGroup = page.getByRole("button", { name: label, exact: true }).first();
  const useMobileNavigation = await page.evaluate(() => window.matchMedia("(width <= 760px)").matches);
  if (!useMobileNavigation) {
    if ((await desktopGroup.getAttribute("aria-expanded")) !== "true") await desktopGroup.click();
    const desktopNavigation = page.locator(desktopSelector);
    await expect(desktopNavigation).toBeVisible();
    return desktopNavigation;
  }

  const moreButton = page.getByRole("button", { name: "更多功能", exact: true }).first();
  if ((await moreButton.getAttribute("aria-expanded")) !== "true") await moreButton.click();
  const mobileNavigation = page.locator("#nav-more");
  await expect(mobileNavigation).toBeVisible();
  return mobileNavigation;
}
