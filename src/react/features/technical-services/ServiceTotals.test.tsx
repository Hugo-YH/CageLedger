import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ServiceTotals } from "./ServiceTotals";

afterEach(cleanup);

it("keeps the four-day ten-eye sample and a two-decimal amount visible for review", () => {
  render(<ServiceTotals days={4} quantity={10} unit="眼" amount={300} />);
  const totals = screen.getByRole("region", { name: "技术服务费用核对" });
  expect(totals).toHaveTextContent("4个服务日");
  expect(totals).toHaveTextContent("10眼");
  expect(totals).toHaveTextContent("300.00元");
  expect(within(totals).getByText("服务日数")).toBeVisible();
});

it("retains confirmed fractional hours and zero amounts without changing units", () => {
  const view = render(<ServiceTotals days={1} quantity={1.25} unit="小时" amount={37.5} />);
  expect(screen.getByRole("region")).toHaveTextContent("1.25小时");
  expect(screen.getByRole("region")).toHaveTextContent("37.50元");
  view.rerender(<ServiceTotals days={0} quantity={0} unit="眼" amount={0} />);
  expect(screen.getByRole("region")).toHaveTextContent("0个服务日");
  expect(screen.getByRole("region")).toHaveTextContent("0.00元");
});
