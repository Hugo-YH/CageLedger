import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { IntakeBatchListItem } from "../../../contracts/intake";
import { IntakeQuarantineStatus } from "./IntakeQuarantineStatus";

const api = vi.hoisted(() => ({ download: vi.fn(), overview: vi.fn() }));
const feedback = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => feedback }));
vi.mock("../../api/quarantine", () => ({ downloadQuarantine: api.download, useQuarantineOverview: api.overview }));
vi.mock("../../components/ui/Modal", () => ({
  Modal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <section role="dialog">{children}</section> : null,
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("uses report summary metadata, merges rapid download clicks, and allows retry after failure", async () => {
  const item: IntakeBatchListItem = {
    id: "intake",
    purchaseOrderNo: "",
    batchNo: "",
    iacuc: "",
    supplier: "",
    species: "mouse",
    strainRaw: "",
    strainStandard: "",
    sex: "",
    quantity: 1,
    roomName: "",
    intakeDate: "",
    pi: "",
    owner: "",
    status: "received",
    notes: "",
    finalCardCount: 0,
    confirmedCardCount: 0,
    remainingCardCount: 0,
    updatedAt: "v1",
    quarantineBatches: [{ id: "batch", name: "Batch", completedAt: "" }],
  };
  api.overview.mockImplementation((id: string) => ({
    data: id
      ? {
          item: { status: "open", conclusion: "" },
          tests: [],
          reports: [{ id: "report", method: "pcr", number: "REPORT-1", version: 2 }],
        }
      : undefined,
  }));
  let reject!: (cause: Error) => void;
  api.download
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, failure) => {
          reject = failure;
        }),
    )
    .mockResolvedValueOnce("report.pdf");
  render(<IntakeQuarantineStatus item={item} />);
  fireEvent.click(screen.getByRole("button", { name: "检疫记录" }));
  const button = screen.getByRole("button", { name: /PCR检测.*REPORT-1.*v\s*2/ });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(api.download).toHaveBeenCalledTimes(1);
  expect(api.download).toHaveBeenCalledWith("reports/report");
  expect(button).toHaveClass("ant-btn-loading");
  reject(new Error("Download failed"));
  await screen.findByText("Download failed");
  await waitFor(() => expect(button).not.toHaveClass("ant-btn-loading"));
  fireEvent.click(button);
  await waitFor(() => expect(feedback.success).toHaveBeenCalledWith("检疫报告已生成，下载已开始", "report.pdf"));
  expect(api.download).toHaveBeenCalledTimes(2);
});
