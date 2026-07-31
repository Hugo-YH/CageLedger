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
  await navigation.getByRole("menuitem", { name: new RegExp(escapeRegExp(name)) }).click();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function openIntakeEntry(page: Page) {
  await openNavigationEntry(page, "笼卡管理", "预约消息识别");
}

export async function openQuantityEntry(page: Page) {
  await openNavigationEntry(page, "饲养费管理", "数量统计表（录入）");
}

export async function openSavedQuantitySheets(page: Page) {
  await openNavigationEntry(page, "饲养费管理", "已保存数量统计表");
}

export async function openWorkflowCenter(page: Page) {
  await openNavigationEntry(page, "饲养费管理", "结算与报销台账");
}

export async function openBillingNavigation(page: Page) {
  return openNavigationGroup(page, "饲养费管理", "#nav-billing");
}

export async function openSettingsNavigation(page: Page) {
  return openNavigationGroup(page, "系统设置", "#nav-settings");
}

async function openNavigationGroup(page: Page, label: string, desktopSelector: string): Promise<Locator> {
  void desktopSelector;
  const desktopGroup = page.getByRole("menuitem", { name: new RegExp(escapeRegExp(label)) }).first();
  const useMobileNavigation = await page.evaluate(() => window.matchMedia("(max-width: 760px)").matches);
  if (useMobileNavigation) {
    const tabLabel = mobileTabLabel(label);
    await page.getByRole("tab", { name: tabLabel }).click();
    if (tabLabel === "更多") {
      const navigation = page.locator(".ant-mobile-navigation-sheet");
      await expect(navigation).toBeVisible();
      return navigation;
    }
    // Direct-destination tabs navigate to the group entry page without a sheet.
    return page.locator(".ant-main-menu");
  }
  if ((await desktopGroup.getAttribute("aria-expanded")) !== "true") await desktopGroup.click();
  return page.locator(".ant-main-menu");
}

async function openNavigationEntry(page: Page, group: string, label: string) {
  const useMobileNavigation = await page.evaluate(() => window.matchMedia("(max-width: 760px)").matches);
  if (useMobileNavigation) {
    const directEntryByGroup: Record<string, string> = {
      笼卡管理: "预约消息识别",
      动物管理: "动物巡检",
      饲养费管理: "数量统计表（录入）",
    };
    if (directEntryByGroup[group] === label) {
      await page.getByRole("tab", { name: mobileTabLabel(group) }).click();
      return;
    }
    await page.getByRole("tab", { name: "更多" }).click();
    await page.locator(".ant-mobile-navigation-sheet").getByText(label, { exact: true }).click();
    return;
  }
  const menu = await openNavigationGroup(page, group, "");
  await menu.getByRole("menuitem", { name: new RegExp(escapeRegExp(label)) }).click();
}

function mobileTabLabel(group: string) {
  return (
    ({ 笼卡管理: "笼卡", 动物管理: "动物", 饲养费管理: "饲养费", 系统设置: "更多" } as Record<string, string>)[group] ||
    group
  );
}
