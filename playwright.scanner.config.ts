import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Exercise the bundled decoder as well as camera lifetime against an isolated API.
// Run: npm exec -- playwright test --config playwright.scanner.config.ts
const apiPort = Number(process.env.CAGELEDGER_E2E_API_PORT || "5184");
const previewPort = Number(process.env.CAGELEDGER_SCANNER_PREVIEW_PORT || "5283");
const previewUrl = `http://127.0.0.1:${previewPort}`;
const apiEnvironment = `CAGELEDGER_API_ORIGIN=http://127.0.0.1:${apiPort}`;
const output = "dist/scanner-production";

export default defineConfig({
  ...base,
  testMatch: "**/scanner-reliability.spec.ts",
  use: { ...base.use, baseURL: previewUrl },
  webServer: [
    ...[base.webServer!].flat().map((server) => ({
      ...server,
      command: `CAGELEDGER_CORS_ALLOWED_ORIGINS=${previewUrl} ${server.command}`,
    })),
    {
      command: `${apiEnvironment} npm exec -- vite build --outDir ${output} && ${apiEnvironment} npm exec -- vite preview --host 127.0.0.1 --port ${previewPort} --outDir ${output}`,
      url: `${previewUrl}/app`,
      timeout: 120_000,
    },
  ],
});
