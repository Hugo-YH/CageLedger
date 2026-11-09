import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./client";
import { aiParseIntakeMessage, intakeDuplicateDetails, previewIntakeReview, saveIntakeBatch } from "./intake";
import { createIntakeDraft } from "../../domain/intake";

describe("intake save API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends duplicate checking and a confirmation token without changing the legacy payload fields", async () => {
    const item = { ...createIntakeDraft("测试"), id: "batch-1", updatedAt: "2026-10-21T10:00:00Z" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ item })));

    await saveIntakeBatch({ item, exists: true, checkDuplicates: true, duplicateConfirmation: "token-1" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/intake-batches/batch-1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          item,
          expectedUpdatedAt: "2026-10-21T10:00:00Z",
          checkDuplicates: true,
          duplicateConfirmation: "token-1",
        }),
      }),
    );
  });

  it("uploads an original once and sends only references for recognition, save and duplicate confirmation", async () => {
    const image = { name: "预约.png", dataUrl: "data:image/png;base64,aGVsbG8=" };
    const item = createIntakeDraft("测试");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url === "/api/intake/recognition-uploads"
              ? {
                  items: [
                    {
                      uploadId: "a".repeat(32),
                      name: image.name,
                      mime: "image/png",
                      size: 5,
                      sha256: "b".repeat(64),
                      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
                    },
                  ],
                }
              : { item },
          ),
        ),
      ),
    );
    const controller = new AbortController();
    await aiParseIntakeMessage("", ["8101"], [image], controller.signal);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/intake/ai-parse",
      expect.objectContaining({
        signal: controller.signal,
        body: JSON.stringify({ rawMessage: "", roomNames: ["8101"], imageRefs: [{ uploadId: "a".repeat(32) }] }),
      }),
    );
    await previewIntakeReview(item, "excluded", [image], controller.signal);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/intake-batches/recognition-preview",
      expect.objectContaining({
        signal: controller.signal,
        body: JSON.stringify({
          reviewVersion: 2,
          item,
          excludeId: "excluded",
          recognitionImageRefs: [{ uploadId: "a".repeat(32) }],
        }),
      }),
    );
    await saveIntakeBatch({ item, exists: false, recognitionImages: [image] });
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/intake-batches",
      expect.objectContaining({
        body: JSON.stringify({ item, recognitionImageRefs: [{ uploadId: "a".repeat(32) }], expectedUpdatedAt: "" }),
      }),
    );
    await saveIntakeBatch({ item, exists: false, recognitionImages: [image], duplicateConfirmation: "confirmed" });
    expect(fetchSpy.mock.calls.filter(([url]) => url === "/api/intake/recognition-uploads")).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    for (const [url, init] of fetchSpy.mock.calls) {
      if (url !== "/api/intake/recognition-uploads") expect(String(init?.body)).not.toContain(image.dataUrl);
    }
  });

  it("recognizes only the duplicate-confirmation conflict shape", () => {
    const details = {
      items: [
        {
          id: "existing",
          purchaseOrderNo: "PO-1",
          batchNo: "B-1",
          intakeDate: "2026-10-21",
          pi: "负责人",
          owner: "实验负责人",
          status: "pending_print",
          matchedFields: ["purchaseOrderNo"],
        },
      ],
      total: 1,
      confirmationToken: "token-1",
    };
    expect(
      intakeDuplicateDetails(
        new ApiError("需要确认", 409, { code: "INTAKE_DUPLICATE_CONFIRMATION_REQUIRED", details }),
      ),
    ).toEqual(details);
    expect(intakeDuplicateDetails(new ApiError("版本过期", 409, { details }))).toBeNull();
    expect(
      intakeDuplicateDetails(
        new ApiError("格式错误", 400, { code: "INTAKE_DUPLICATE_CONFIRMATION_REQUIRED", details }),
      ),
    ).toBeNull();
  });

  it("binds explicit field resolutions to the preview and the versioned merge confirmation", async () => {
    const item = { ...createIntakeDraft("测试"), id: "original", updatedAt: "saved-v1" };
    const resolutions = { sex: "incoming" as const, intakeDate: "incoming" as const };
    const controller = new AbortController();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ item }))));
    await previewIntakeReview(item, undefined, [], controller.signal, resolutions);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/intake-batches/recognition-preview",
      expect.objectContaining({
        signal: controller.signal,
        body: JSON.stringify({ reviewVersion: 2, item, resolutions }),
      }),
    );
    const recognitionMerge = {
      reviewVersion: 2 as const,
      incoming: item,
      confirmationToken: "choices-token",
      resolutions,
    };
    await saveIntakeBatch({ item, exists: true, recognitionMerge });
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/intake-batches/original",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ item, recognitionMerge, expectedUpdatedAt: "saved-v1" }),
      }),
    );
  });
});
