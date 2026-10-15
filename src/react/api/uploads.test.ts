import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadFile } from "./administration";
import { uploadAnimalInspectionPhoto } from "./animalManagement";
import { uploadWorkflowAttachment } from "./workflows";
import { uploadFeedbackAttachment } from "./feedback";
import { captureDiagnostics, clearDiagnostics } from "../diagnostics/collector";

const file = new File(["image"], "private-name.png", { type: "image/png" });
const cases = [
  {
    name: "feedback original screenshot",
    url: "/api/feedback/record%20id/attachments?requestId=request+id",
    run: () => uploadFeedbackAttachment("record id", "request id", file),
    itemOnly: true,
  },
  {
    name: "feedback supplement screenshot",
    url: "/api/feedback/record%20id/attachments?requestId=request+id&commentId=comment+id",
    run: () => uploadFeedbackAttachment("record id", "request id", file, "comment id"),
    itemOnly: true,
  },
  {
    name: "generic upload",
    url: "/api/quarantine/tests/record/attachments",
    run: () => uploadFile("/api/quarantine/tests/record/attachments", file),
    itemOnly: false,
  },
  {
    name: "inspection photo",
    url: "/api/animal-inspections/record%20id/attachments?findingId=finding%20id",
    run: () => uploadAnimalInspectionPhoto("record id", "finding id", file),
    itemOnly: false,
  },
  {
    name: "workflow attachment",
    url: "/api/billing-workflows/record%20id/attachments?kind=settlement",
    run: () => uploadWorkflowAttachment("record id", "settlement", file),
    itemOnly: true,
  },
];

afterEach(() => {
  vi.restoreAllMocks();
  clearDiagnostics();
});

describe.each(cases)("$name", ({ url, run, itemOnly }) => {
  it("keeps its endpoint, multipart field, and returned business payload", async () => {
    const payload = { item: { id: "attachment" }, retainedField: "preserved" };
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload)));
    await expect(run()).resolves.toEqual(itemOnly ? payload.item : payload);
    expect(fetch.mock.calls[0][0]).toBe(url);
    const init = fetch.mock.calls[0][1];
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get("file")).toBe(file);
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  });

  it("retains HTTP status and trace id and records a sanitized failed request", async () => {
    clearDiagnostics();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"error":"denied"}', {
        status: 403,
        headers: { "X-Request-ID": "abcdef0123456789" },
      }),
    );
    await expect(run()).rejects.toMatchObject({
      name: "ApiError",
      message: "denied",
      status: 403,
      code: "HTTP_403",
      requestId: "abcdef0123456789",
    });
    expect(captureDiagnostics().events).toContainEqual(
      expect.objectContaining({ kind: "request", status: 403, method: "POST" }),
    );
    expect(JSON.stringify(captureDiagnostics())).not.toMatch(/private-name|record%20id|finding%20id/);
  });
});

it("does not accept a successful feedback response without the required attachment", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  await expect(uploadFeedbackAttachment("record", "request", file)).rejects.toMatchObject({
    name: "ApiError",
    status: 200,
    code: "INVALID_RESPONSE",
  });
});
