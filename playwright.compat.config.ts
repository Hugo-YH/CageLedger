import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";
import { compatibilityCatalog } from "./tests/e2e/compatibilityCases";

const browser = process.env.CAGELEDGER_COMPAT_BROWSER;
if (browser !== "firefox" && browser !== "webkit") {
  throw new Error("Use npm run test:e2e:compat (CAGELEDGER_COMPAT_BROWSER must be firefox or webkit)");
}
const evidence = resolve(process.env.CAGELEDGER_COMPAT_OUTPUT_DIR || "test-results/desktop-compat", browser);
if (!base.webServer || Array.isArray(base.webServer)) {
  throw new Error("Desktop compatibility expects the shared ephemeral web server configuration");
}

export default defineConfig({
  ...base,
  workers: 1,
  retries: 0,
  outputDir: resolve(evidence, "artifacts"),
  reporter: [
    ["list"],
    ["json", { outputFile: resolve(evidence, "results.json") }],
    ["html", { outputFolder: resolve(evidence, "report"), open: "never" }],
  ],
  grep: /@compat-[a-z0-9-]+/,
  projects: [
    {
      name: browser,
      metadata: {
        desktopOnly: true,
        scope: "Desktop engine compatibility; not physical-device certification",
        compatibilityCatalog,
      },
      use: {
        ...devices[browser === "firefox" ? "Desktop Firefox" : "Desktop Safari"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: { ...base.webServer, reuseExistingServer: false },
});
