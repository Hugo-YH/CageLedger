import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const [sourcePath, outputPath] = process.argv.slice(2);

if (!sourcePath || !outputPath) {
  process.exitCode = 2;
} else {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(sourcePath).href, { waitUntil: "load" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      preferCSSPageSize: true,
      printBackground: true,
    });
  } finally {
    await browser.close();
  }
}
