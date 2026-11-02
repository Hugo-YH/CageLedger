import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { QuantityPreviewModal } from "./QuantityPreviewModal";

vi.mock("../../../hooks/useOperationFeedback", () => ({
  useOperationFeedback: () => ({ info: vi.fn(), error: vi.fn() }),
}));
vi.mock("../hooks/usePdfExport", () => ({ usePdfExport: () => ({ isExporting: false, exportPdf: vi.fn() }) }));
vi.mock("../../../components/ui/Modal", () => ({
  Modal: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <section role="dialog">
      {children}
      {footer}
    </section>
  ),
}));
vi.mock("../../../components/WorkspaceUi", () => ({ PageSkeleton: () => <div aria-label="详情正在加载" /> }));
afterEach(cleanup);

it("shows a contextual read failure and retry instead of an endless skeleton", () => {
  const retry = vi.fn();
  render(<QuantityPreviewModal loading={false} error="连接暂时中断" onRetry={retry} onClose={vi.fn()} />);
  expect(screen.getByRole("alert")).toHaveTextContent("连接暂时中断");
  expect(screen.queryByLabelText("详情正在加载")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: /打\s*印/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "导出 PDF" })).toBeDisabled();
});
