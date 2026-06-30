import { expect, test as base } from "@playwright/test";

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
