import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const apiOrigin = process.env.CAGELEDGER_API_ORIGIN || "http://127.0.0.1:5174";
const docsOrigin = process.env.CAGELEDGER_DOCS_ORIGIN || "http://127.0.0.1:5175";

export default defineConfig({
  plugins: [react()],
  publicDir: "assets",
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: ["clt.cellnucle.us"],
    proxy: {
      "/api": apiOrigin,
      "/docs": docsOrigin,
    },
  },
  build: {
    outDir: "web-dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "vendor-react", test: /node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)/ },
            { name: "vendor-query", test: /node_modules[\\/]@tanstack/ },
          ],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
