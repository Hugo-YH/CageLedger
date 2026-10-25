import { describe, expect, it } from "vitest";
import {
  FIREFOX_SCROLL_ADVISORY,
  isFirefoxScrollAdvisory,
  type BrowserConsoleRecord,
} from "./browserConsoleDiagnostic";

const appUrl = "http://127.0.0.1:5463/app";
const native: BrowserConsoleRecord = {
  type: "warning",
  text: `[JavaScript Warning: "${FIREFOX_SCROLL_ADVISORY}" {file: "${appUrl}" line: 0}]`,
  location: { url: appUrl, lineNumber: 0, columnNumber: 1 },
};
describe("native Firefox performance diagnostic provenance", () => {
  it("recognizes only the exact native advisory", () => {
    expect(isFirefoxScrollAdvisory(native, "firefox", appUrl)).toBe(true);
  });
  it.each([
    { ...native, type: "error" },
    { ...native, text: FIREFOX_SCROLL_ADVISORY },
    { ...native, text: native.text + " application detail" },
    { ...native, text: "Warning: Maximum update depth exceeded" },
    { ...native, location: { ...native.location, url: appUrl + "/src.tsx" } },
    { ...native, location: { ...native.location, url: "debugger eval code" } },
    { ...native, location: { ...native.location, lineNumber: 1 } },
    { ...native, location: { ...native.location, columnNumber: 2 } },
  ])("retains unexpected errors/warnings or application provenance (%#)", (record) => {
    expect(isFirefoxScrollAdvisory(record, "firefox", appUrl)).toBe(false);
  });
  it("never reclassifies other engines or documents", () => {
    expect(isFirefoxScrollAdvisory(native, "chromium", appUrl)).toBe(false);
    expect(isFirefoxScrollAdvisory(native, "webkit", appUrl)).toBe(false);
    expect(isFirefoxScrollAdvisory(native, "firefox", "http://127.0.0.1:5453/app")).toBe(false);
    expect(isFirefoxScrollAdvisory(native, "firefox", "")).toBe(false);
  });
});
