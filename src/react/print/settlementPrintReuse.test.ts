import { afterEach, expect, it, vi } from "vitest";

import type { BillingStatementResponse } from "../api/contracts";
import parityFixture from "./fixtures/settlement-parity.json";
import { openSettlementPrint, settlementStatementHtml } from "./settlement";

afterEach(() => vi.restoreAllMocks());

const feeding = parityFixture as BillingStatementResponse;
const service: BillingStatementResponse = {
  statement: {
    ...feeding.statement,
    sourceType: "pi_merged_technical_service",
    serviceDayCount: 1,
    technicalServiceRows: [
      {
        date: "2026-08-01",
        iacuc: "Z-PARITY-SERVICE",
        facility: "zhujiang",
        serviceName: "服务<script>",
        quantity: 1,
        unit: "次",
        unitPrice: 90,
        amount: 90,
      },
    ],
  },
  lines: [],
};

it.each([
  ["feeding", feeding],
  ["service", service],
] as const)(
  "prints the memoized %s preview with exactly the original autoPrint document and no model rebuild",
  (_kind, result) => {
    const preview = settlementStatementHtml(result, false);
    const expectedPrint = settlementStatementHtml(result);
    const readStatement = vi.fn(() => result.statement);
    const current = {
      ...result,
      get statement() {
        return readStatement();
      },
    };
    const write = vi.fn();
    const close = vi.fn();
    vi.spyOn(window, "open").mockReturnValue({ document: { write, close } } as unknown as Window);
    expect(openSettlementPrint(current, preview)).toBe(true);
    expect(openSettlementPrint(current, preview)).toBe(true);
    expect(readStatement).not.toHaveBeenCalled();
    expect(write.mock.calls).toEqual([[expectedPrint], [expectedPrint]]);
    expect(close).toHaveBeenCalledTimes(2);
  },
);

it("keeps the standalone print path and blocked-popup behavior", () => {
  const write = vi.fn();
  const open = vi
    .spyOn(window, "open")
    .mockReturnValueOnce(null)
    .mockReturnValueOnce({ document: { write, close: vi.fn() } } as unknown as Window);
  expect(openSettlementPrint(feeding)).toBe(false);
  expect(write).not.toHaveBeenCalled();
  expect(openSettlementPrint(feeding)).toBe(true);
  expect(open).toHaveBeenCalledTimes(2);
  expect(write).toHaveBeenCalledExactlyOnceWith(settlementStatementHtml(feeding));
});
