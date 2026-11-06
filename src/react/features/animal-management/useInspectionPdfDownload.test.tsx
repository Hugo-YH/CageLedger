import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useInspectionPdfDownload } from "./useInspectionPdfDownload";

const api = vi.hoisted(() => ({ download: vi.fn(), success: vi.fn() }));
vi.mock("../../api/animalManagement", () => ({ downloadAnimalInspectionPdf: api.download }));
vi.mock("../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => ({ success: api.success }) }));

it("locks rapid export clicks synchronously and permits an explicit retry after failure", async () => {
  let reject!: (error: Error) => void;
  api.download.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const hook = renderHook(() => useInspectionPdfDownload());
  let request!: Promise<void>;
  act(() => {
    request = hook.result.current.download("inspection");
    void hook.result.current.download("inspection");
  });
  expect(api.download).toHaveBeenCalledExactlyOnceWith("inspection");
  expect(hook.result.current.pendingId).toBe("inspection");
  await act(async () => {
    reject(new Error("转换失败"));
    await request;
  });
  expect(hook.result.current.failure).toEqual({ id: "inspection", message: "转换失败" });
  expect(hook.result.current.pendingId).toBe("");
  api.download.mockResolvedValueOnce("inspection.pdf");
  await act(() => hook.result.current.download("inspection"));
  expect(api.download).toHaveBeenCalledTimes(2);
  expect(hook.result.current.failure).toBeNull();
  expect(api.success).toHaveBeenCalledOnce();
});
