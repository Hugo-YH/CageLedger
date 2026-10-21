import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./client";
import { intakeDuplicateDetails, saveIntakeBatch } from "./intake";
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
});
