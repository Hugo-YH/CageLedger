import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { BatchReportExport } from "./BatchReportExport";

const download = vi.hoisted(() => vi.fn());
const feedback = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => feedback }));
vi.mock("../../api/quarantine", () => ({ downloadQuarantine: download }));
vi.mock("../../components/ui/Modal", () => ({
  Modal: ({ open, children, footer }: { open: boolean; children: ReactNode; footer: ReactNode }) =>
    open ? (
      <section role="dialog">
        {children}
        {footer}
      </section>
    ) : null,
}));
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }),
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps download failure in the export form and replaces it with one operation result after retry", async () => {
  download.mockRejectedValueOnce(new Error("报告暂时不可用")).mockResolvedValueOnce("检疫报告.pdf");
  render(<BatchReportExport batchId="batch" disabled={false} />);
  fireEvent.click(screen.getByRole("button", { name: "下载汇总PDF" }));
  fireEvent.click(screen.getAllByRole("button", { name: "下载汇总PDF" })[1]);
  await screen.findByText("报告暂时不可用");
  expect(feedback.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "下载汇总PDF" })[1]);
  await waitFor(() => expect(feedback.success).toHaveBeenCalledWith("检疫汇总 PDF 已生成，下载已开始", "检疫报告.pdf"));
  expect(feedback.success).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("报告暂时不可用")).not.toBeInTheDocument();
  expect(screen.queryByText("已下载 检疫报告.pdf")).not.toBeInTheDocument();
});
