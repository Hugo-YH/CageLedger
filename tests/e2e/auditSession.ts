import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

/** Authenticate each audit's own browser context without repeating the login UI journey. */
export async function openAuthenticatedAuditPage(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { username: "admin", password: "admin123" },
  });
  await expect(response).toBeOK();
  await page.goto("/app");
  await expect(page.getByLabel("用户名", { exact: true })).toBeHidden();
}
