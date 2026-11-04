import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResearcherImportPreview, ResearcherImportResult } from "../../../contracts/researchers";
import { ApiError } from "../../api/client";
import { readResearcherFile, useResearcherImportFlow } from "./useResearcherImportFlow";

const api = vi.hoisted(() => ({ preview: vi.fn(), import: vi.fn() }));
vi.mock("../../api/researchers", () => ({
  usePreviewResearcherImport: () => ({ mutateAsync: api.preview }),
  useImportResearchers: () => ({ mutateAsync: api.import }),
}));

const preview: ResearcherImportPreview = {
  fileName: "人员.xlsx",
  total: 3,
  counts: { created: 1, updated: 1, unchanged: 1, invalid: 0 },
  rows: [],
  confirmationToken: "preview-token",
  canImport: true,
};
const imported: ResearcherImportResult = {
  total: 3,
  counts: preview.counts,
  updatedAt: "new-version",
  replayed: false,
};
function file(name = "人员.xlsx") {
  return new File(["xlsx fixture"], name);
}

beforeEach(() => {
  api.preview.mockReset().mockResolvedValue(preview);
  api.import.mockReset().mockResolvedValue(imported);
});
afterEach(cleanup);

describe("researcher import intent", () => {
  it("selects and previews without writing, then retries an uncertain result with the identical request identity", async () => {
    const onImported = vi.fn();
    api.import.mockRejectedValueOnce(new Error("网络断开"));
    const { result } = renderHook(() => useResearcherImportFlow(onImported));
    await act(() => result.current.chooseFile(file()));
    expect(api.import).not.toHaveBeenCalled();
    expect(api.preview).toHaveBeenCalledWith({ filename: "人员.xlsx", data: btoa("xlsx fixture") });
    await act(() => result.current.confirmImport());
    const first = api.import.mock.calls[0][0];
    expect(first.requestId).toMatch(/^[a-f\d-]{36}$/);
    expect(result.current.file?.filename).toBe("人员.xlsx");
    expect(result.current.preview).toBe(preview);
    await act(() => result.current.confirmImport());
    expect(api.import.mock.calls[1][0]).toEqual(first);
    expect(onImported).toHaveBeenCalledWith(imported);
  });

  it("requires a new preview after conflict and generates a new identity only after explicit repreview", async () => {
    api.import.mockRejectedValueOnce(new ApiError("资料版本已变化", 409, {}));
    const { result } = renderHook(() => useResearcherImportFlow(vi.fn()));
    await act(() => result.current.chooseFile(file()));
    await act(() => result.current.confirmImport());
    expect(result.current.needsPreview).toBe(true);
    expect(result.current.canConfirm).toBe(false);
    await act(() => result.current.confirmImport());
    expect(api.import).toHaveBeenCalledTimes(1);
    api.preview.mockResolvedValue({ ...preview, confirmationToken: "fresh-token" });
    await act(() => result.current.repreview());
    await act(() => result.current.confirmImport());
    expect(api.import.mock.calls[1][0].confirmationToken).toBe("fresh-token");
    expect(api.import.mock.calls[1][0].requestId).not.toBe(api.import.mock.calls[0][0].requestId);
  });

  it("blocks every invalid preview even if the server canImport flag is true", async () => {
    api.preview.mockResolvedValue({ ...preview, counts: { ...preview.counts, invalid: 1 } });
    const { result } = renderHook(() => useResearcherImportFlow(vi.fn()));
    await act(() => result.current.chooseFile(file()));
    expect(result.current.canConfirm).toBe(false);
    await act(() => result.current.confirmImport());
    expect(api.import).not.toHaveBeenCalled();
  });

  it("keeps the newest selected file when an older preview returns late", async () => {
    let resolveOld!: (value: ResearcherImportPreview) => void;
    let entered!: () => void;
    const reachedPreview = new Promise<void>((resolve) => {
      entered = resolve;
    });
    api.preview.mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    });
    const { result } = renderHook(() => useResearcherImportFlow(vi.fn()));
    let old!: Promise<void>;
    act(() => {
      old = result.current.chooseFile(file("旧表.xlsx"));
    });
    await act(() => reachedPreview);
    api.preview.mockResolvedValue({ ...preview, fileName: "新表.xlsx", confirmationToken: "new-file-token" });
    await act(() => result.current.chooseFile(file("新表.xlsx")));
    await act(async () => {
      resolveOld({ ...preview, fileName: "旧表.xlsx" });
      await old;
    });
    expect(result.current.fileName).toBe("新表.xlsx");
    expect(result.current.preview?.confirmationToken).toBe("new-file-token");
  });

  it("retires late preview and import callbacks on dialog close or unmount", async () => {
    let resolveImport!: (value: ResearcherImportResult) => void;
    api.import.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        }),
    );
    const onImported = vi.fn();
    const { result, unmount } = renderHook(() => useResearcherImportFlow(onImported));
    await act(() => result.current.chooseFile(file()));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.confirmImport();
    });
    unmount();
    await act(async () => {
      resolveImport(imported);
      await pending;
    });
    expect(onImported).not.toHaveBeenCalled();
  });

  it("rejects unsupported or oversized files before any preview request", async () => {
    await expect(readResearcherFile(file("人员.xls"))).rejects.toThrow(".xlsx");
    const large = file();
    Object.defineProperty(large, "size", { value: 10 * 1024 * 1024 + 1 });
    const { result } = renderHook(() => useResearcherImportFlow(vi.fn()));
    await act(() => result.current.chooseFile(large));
    expect(result.current.error).toContain("10 MiB");
    expect(result.current.previewing).toBe(false);
    expect(api.preview).not.toHaveBeenCalled();
  });
});
