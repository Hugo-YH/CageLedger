import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { exportMonthlyBillingSummary } from "../../../api/settlements";
import { MonthlyBillingSummary } from "./MonthlyBillingSummary";

vi.mock("../../../api/settlements", () => ({ exportMonthlyBillingSummary: vi.fn() }));
vi.mock("../../../components/ui", () => ({
  CommandBar: ({ primaryAction, filters }: { primaryAction: React.ReactNode; filters: React.ReactNode }) => (
    <div>
      {filters}
      {primaryAction}
    </div>
  ),
  DateInput: ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => (
    <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
  HelpPopover: () => null,
}));

beforeEach(() => {
  vi.mocked(exportMonthlyBillingSummary).mockReset();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows an export failure as an error and retries the same selected month", async () => {
  vi.mocked(exportMonthlyBillingSummary)
    .mockRejectedValueOnce(new Error("导出服务暂时不可用"))
    .mockResolvedValueOnce("2026年10月费用汇总.xlsx");
  render(<MonthlyBillingSummary />);
  fireEvent.change(screen.getByLabelText("结算月份"), { target: { value: "2026-10" } });
  fireEvent.click(screen.getByRole("button", { name: "导出月度汇总 Excel" }));
  const failure = (await screen.findByText("导出服务暂时不可用")).closest(".ant-alert");
  expect(failure).toHaveTextContent("导出服务暂时不可用");
  expect(failure).toHaveClass("ant-alert-error");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "重试导出" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2026年10月费用汇总.xlsx 已开始下载。"));
  expect(screen.queryByText("导出服务暂时不可用")).not.toBeInTheDocument();
  expect(exportMonthlyBillingSummary).toHaveBeenNthCalledWith(1, "2026-10");
  expect(exportMonthlyBillingSummary).toHaveBeenNthCalledWith(2, "2026-10");
});

it("keeps a real export pending and removes a previous success before retrying", async () => {
  let resolve: (filename: string) => void = () => undefined;
  vi.mocked(exportMonthlyBillingSummary).mockResolvedValueOnce("首次.xlsx");
  render(<MonthlyBillingSummary />);
  const button = screen.getByRole("button", { name: "导出月度汇总 Excel" });
  fireEvent.click(button);
  await screen.findByRole("status");
  vi.mocked(exportMonthlyBillingSummary).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(button);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  await waitFor(() => expect(button).toHaveClass("ant-btn-loading"));
  resolve("第二次.xlsx");
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("第二次.xlsx 已开始下载。"));
});
