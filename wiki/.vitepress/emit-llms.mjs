import fs from "node:fs";
import path from "node:path";

import { pageRoutes } from "./page-routes.mjs";

/**
 * VitePress build hook that makes the documentation LLM-friendly:
 *
 * 1. Emits the raw Markdown of every routed page next to its HTML output so
 *    each page can be read as `${url}.md` in production (the dev server already
 *    serves Markdown for `.md` URLs).
 * 2. Generates `/docs/llms.txt` following the llms.txt proposal
 *    (https://llmstxt.org/): H1 + blockquote summary + H2 file lists.
 */
export function emitLlms() {
  return {
    name: "cageledger-emit-llms",
    async buildEnd(siteConfig) {
      const wikiDir = siteConfig.srcDir;
      const outDir = siteConfig.outDir;

      fs.mkdirSync(outDir, { recursive: true });
      for (const [source, route] of Object.entries(pageRoutes)) {
        const sourcePath = path.join(wikiDir, source);
        if (!fs.existsSync(sourcePath)) continue;
        const outputPath = path.join(outDir, route);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.copyFileSync(sourcePath, outputPath);
      }

      // Pages without a rewrite entry (e.g. LLMs.md) keep their source file
      // name and are emitted next to their HTML output as well.
      for (const name of fs.readdirSync(wikiDir)) {
        if (!name.endsWith(".md")) continue;
        if (name in pageRoutes) continue;
        const sourcePath = path.join(wikiDir, name);
        if (!fs.statSync(sourcePath).isFile()) continue;
        fs.copyFileSync(sourcePath, path.join(outDir, name));
      }

      const llmsSource = path.join(wikiDir, "LLMs.md");
      if (fs.existsSync(llmsSource)) {
        fs.copyFileSync(llmsSource, path.join(outDir, "llms.txt"));
      }
    },
  };
}
