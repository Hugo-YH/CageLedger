import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.CAGELEDGER_E2E_PORT || "5183");
const e2eApiPort = Number(process.env.CAGELEDGER_E2E_API_PORT || "5184");
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: {
    timeout: process.env.CI ? 15_000 : 5_000,
  },
  retries: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: e2eBaseUrl,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `CAGELEDGER_EPHEMERAL_DB=1 CAGELEDGER_DEV_PORT=${e2ePort} CAGELEDGER_DEV_API_PORT=${e2eApiPort} CAGELEDGER_API_ORIGIN=http://127.0.0.1:${e2eApiPort} npm run dev`,
    url: `${e2eBaseUrl}/api/health`,
    reuseExistingServer: process.env.CAGELEDGER_E2E_REUSE === "1",
    timeout: 120_000,
  },
});
