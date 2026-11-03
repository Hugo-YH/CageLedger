import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IntakeNumberFilters } from "./IntakeNumberFilters";

afterEach(cleanup);

it("submits server filters together without interpreting approval as receipt date", () => {
  const onFilter = vi.fn();
  render(<IntakeNumberFilters filters={{}} onFilter={onFilter} loading={false} />);
  fireEvent.change(screen.getByLabelText("部分批次编号"), { target: { value: " (z2025137） " } });
  fireEvent.change(screen.getByLabelText("编号内 IACUC"), { target: { value: "Z2025137" } });
  fireEvent.change(screen.getByLabelText("实验需求审批日期"), { target: { value: "2026-10-14" } });
  fireEvent.change(screen.getByLabelText("批次序号"), { target: { value: "06" } });
  expect(onFilter).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole("form", { name: "批次编号全库查询" }));
  expect(onFilter.mock.calls).toEqual([
    ["batchNumberSearch", ["(z2025137）"]],
    ["batchNumberIacuc", ["Z2025137"]],
    ["batchApprovalDate", ["2026-10-14"]],
    ["batchSequence", ["06"]],
  ]);
  onFilter.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "清除编号条件" }));
  expect(onFilter.mock.calls).toEqual([
    ["batchNumberSearch", []],
    ["batchNumberIacuc", []],
    ["batchApprovalDate", []],
    ["batchSequence", []],
  ]);
  expect(screen.getByLabelText("部分批次编号")).toHaveValue("");
});
