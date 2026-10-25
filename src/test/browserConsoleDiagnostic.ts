/** Firefox's native performance advisory is not an application runtime exception.
 * Keep its exact provenance and wording; a similar console.warn from application
 * code, another engine, another document, or any other warning must still fail.
 * https://firefox-source-docs.mozilla.org/performance/scroll-linked_effects.html
 */
export const FIREFOX_SCROLL_ADVISORY =
  "This site appears to use a scroll-linked positioning effect. This may not work well with asynchronous panning; see https://firefox-source-docs.mozilla.org/performance/scroll-linked_effects.html for further details and to join the discussion on related tools and features!";

export type BrowserConsoleRecord = {
  type: string;
  text: string;
  location: { url: string; lineNumber: number; columnNumber: number };
};

export function isFirefoxScrollAdvisory(record: BrowserConsoleRecord, browser: string, appUrl: string) {
  return (
    browser === "firefox" &&
    record.type === "warning" &&
    /^https?:\/\/[^/]+\/app$/.test(appUrl) &&
    record.location.url === appUrl &&
    record.location.lineNumber === 0 &&
    record.location.columnNumber === 1 &&
    record.text === `[JavaScript Warning: "${FIREFOX_SCROLL_ADVISORY}" {file: "${appUrl}" line: 0}]`
  );
}
