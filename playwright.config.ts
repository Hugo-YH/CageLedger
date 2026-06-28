import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "CAGELEDGER_EPHEMERAL_DB=1 npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: process.env.CAGELEDGER_E2E_REUSE === "1",
    timeout: 120_000,
  },
});
