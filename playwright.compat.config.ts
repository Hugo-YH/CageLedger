import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

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
  testMatch: [
    "desktop-compat.spec.ts",
    "zz-ant-system-audit.spec.ts",
    "filter-motion.spec.ts",
    "quantity.spec.ts",
    "async-feedback.spec.ts",
    "quarantine-toolbar.spec.ts",
    "quarantine.spec.ts",
    "quarantine-experience.spec.ts",
    "inspection-catalog.spec.ts",
    "settings-inspection-resilience.spec.ts",
    "permissions.spec.ts",
    "loading-feedback.spec.ts",
    "accessibility.spec.ts",
  ],
  grep: [
    /desktop compatibility:/,
    /Ant system page inventory (1440|1180)$/,
    /column filters stay onscreen: (no-preference|reduce) (1440|1180)$/,
    /saved quantity filters remain clickable/,
    /save and delete a quantity sheet/,
    /selects every saved quantity sheet/,
    /failed settlement list has a retry/,
    /manual selection wins over a slow select-all/,
    /workflow details open immediately/,
    /quarantine selection survives pagination/,
    /ELISA report form links sources/,
    /elisa_mouse record preserves failed save/,
    /admin edits the catalog/,
    /finding actions serialize requests/,
    /inspection detail shows loading/,
    /room administrator keeps the server-side permission boundary/,
    /batch search retains rows/,
    /core workspaces and dialogs retain accessible semantics/,
  ],
  projects: [
    {
      name: browser,
      metadata: { desktopOnly: true, scope: "Desktop engine compatibility; not physical-device certification" },
      use: {
        ...devices[browser === "firefox" ? "Desktop Firefox" : "Desktop Safari"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: { ...base.webServer, reuseExistingServer: false },
});
