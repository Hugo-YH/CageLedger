import type { TestDetails } from "@playwright/test";
import compatibilityCatalog from "./compatibility-catalog.json" with { type: "json" };

export { compatibilityCatalog };

/** Stable coverage identity, independent of the test's display title. */
export function compatibilityCase(id: string, enabled = true): TestDetails {
  const tag = `@compat-${id}`;
  if (enabled && !compatibilityCatalog.includes(tag)) {
    throw new Error(`Compatibility case is missing from compatibility-catalog.json: ${tag}`);
  }
  return { tag: enabled ? [tag] : [] };
}
