import { CancelledError } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { ApiError } from "./client";
import { shouldRetryQuery } from "./queryClient";

describe("query retry policy", () => {
  it.each([400, 401, 403, 404, 409, 422])("does not retry HTTP %i", (status) => {
    expect(shouldRetryQuery(0, new ApiError("error", status, {}))).toBe(false);
  });

  it.each([408, 429, 500, 502, 503, 504])("retries HTTP %i at most once", (status) => {
    const error = new ApiError("error", status, {});
    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(1, error)).toBe(false);
  });

  it("retries network failures once but never cancellations or programming errors", () => {
    expect(shouldRetryQuery(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryQuery(1, new TypeError("Failed to fetch"))).toBe(false);
    expect(shouldRetryQuery(0, new CancelledError())).toBe(false);
    expect(shouldRetryQuery(0, new DOMException("Aborted", "AbortError"))).toBe(false);
    expect(shouldRetryQuery(0, new SyntaxError("Invalid JSON"))).toBe(false);
    expect(shouldRetryQuery(0, new Error("Unexpected state"))).toBe(false);
  });
});
