import { describe, expect, it } from "vitest";

import { bootstrapUrl } from "./bootstrap";

describe("bootstrapUrl", () => {
  it("builds summary and room-scoped requests", () => {
    expect(bootstrapUrl("summary")).toBe("/api/bootstrap?scope=summary");
    expect(bootstrapUrl("room", "room 8014")).toBe("/api/bootstrap?scope=room&roomId=room+8014");
  });
});
