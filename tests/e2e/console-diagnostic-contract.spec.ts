import { expect, test } from "@playwright/test";
import { FIREFOX_SCROLL_ADVISORY, isFirefoxScrollAdvisory } from "../../src/test/browserConsoleDiagnostic";

// Raw Playwright is intentional: this test emits errors to verify classification.
// Application workflows continue to use fixtures.ts and its failure assertions.
test("console diagnostic provenance retains real application warnings and exceptions", async ({
  page,
  browserName,
}, info) => {
  await page.goto("/app");
  const appUrl = new URL("/app", page.url()).href;
  const lookalike = `[JavaScript Warning: "${FIREFOX_SCROLL_ADVISORY}" {file: "${appUrl}" line: 0}]`;
  const records = [];
  for (const text of [lookalike, "Warning: Maximum update depth exceeded"]) {
    const pending = page.waitForEvent("console", { predicate: (message) => message.text() === text });
    await page.evaluate((value) => console.warn(value), text);
    const message = await pending;
    const record = { type: message.type(), text: message.text(), location: message.location() };
    expect(isFirefoxScrollAdvisory(record, browserName, appUrl)).toBe(false);
    records.push(record);
  }
  const pendingError = page.waitForEvent("console", {
    predicate: (message) => message.text() === "application-error-sentinel",
  });
  await page.evaluate(() => console.error("application-error-sentinel"));
  const message = await pendingError;
  expect(
    isFirefoxScrollAdvisory(
      { type: message.type(), text: message.text(), location: message.location() },
      browserName,
      appUrl,
    ),
  ).toBe(false);
  const uncaught = page.waitForEvent("pageerror");
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("uncaught-sentinel");
    }, 0);
  });
  expect((await uncaught).message).toBe("uncaught-sentinel");
  await info.attach("application-warning-provenance", {
    body: JSON.stringify(records, null, 2),
    contentType: "application/json",
  });
});
