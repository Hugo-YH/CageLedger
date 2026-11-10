import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";

import type { SessionUser } from "../../src/contracts/session";
import { expect, test as base } from "./fixtures";

const accounts = new WeakMap<Page, { username: string; password: string }>();

/** Image-only reviews retain bounded uploads under their real account owner. */
export const test = base.extend({
  page: async ({ page, playwright, baseURL }, runPage) => {
    const admin = await playwright.request.newContext({ baseURL });
    let userId = "";
    try {
      const health = await admin.get("/api/health");
      expect(health.ok()).toBe(true);
      expect(((await health.json()) as { database: string }).database).toContain("cageledger-e2e-");
      const login = await admin.post("/api/auth/login", { data: { username: "admin", password: "admin123" } });
      expect(login.ok(), await login.text()).toBe(true);
      const { user: original } = (await login.json()) as { user: SessionUser };
      expect(original.role).toBe("admin");
      const credentials = { username: `intake-e2e-${randomUUID()}`, password: `intake-${randomUUID()}` };
      const fields = {
        displayName: original.displayName,
        phone: original.phone,
        role: original.role,
        roomIds: original.roomIds,
        billingLockAllowed: original.billingLockAllowed,
      };
      const created = await admin.post("/api/users", { data: { ...credentials, ...fields } });
      expect(created.ok(), await created.text()).toBe(true);
      const { user } = (await created.json()) as { user: SessionUser };
      userId = user.id;
      expect(user).toMatchObject({ username: credentials.username, ...fields });
      accounts.set(page, credentials);
      await runPage(page);
    } finally {
      accounts.delete(page);
      try {
        if (userId) {
          const deleted = await admin.delete(`/api/users/${encodeURIComponent(userId)}`);
          expect(deleted.ok(), await deleted.text()).toBe(true);
        }
      } finally {
        await admin.dispose();
      }
    }
  },
});

export async function loginIntakeAccount(page: Page) {
  const account = accounts.get(page);
  if (!account) throw new Error("Missing this test's isolated intake account");
  await page.goto("/app");
  await page.getByLabel("用户名", { exact: true }).fill(account.username);
  await page.getByLabel("密码", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
}
