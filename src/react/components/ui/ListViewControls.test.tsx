import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ListViewControls } from "./ListViewControls";

afterEach(cleanup);

it("labels domain values without sending display labels back as API filters", () => {
  const onFiltersChange = vi.fn();
  render(
    <ListViewControls
      filters={{ facility: ["zhujiang"], status: ["editable"] }}
      labels={{ facility: "服务设施", status: "状态" }}
      valueLabels={{ facility: { zhujiang: "珠江新城" }, status: { editable: "可编辑" } }}
      onFiltersChange={onFiltersChange}
      density="middle"
      onDensity={vi.fn()}
    />,
  );
  expect(screen.getByText("状态：可编辑")).toBeVisible();
  const facility = screen.getByText("服务设施：珠江新城").closest(".ant-tag");
  fireEvent.click(facility!.querySelector<HTMLElement>(".ant-tag-close-icon")!);
  expect(onFiltersChange).toHaveBeenCalledWith({ status: ["editable"] });
});

it("retains existing labels, filter clearing and density actions without value mappings", () => {
  const onFiltersChange = vi.fn();
  const onDensity = vi.fn();
  render(
    <ListViewControls
      filters={{ month: ["2026-10"] }}
      onFiltersChange={onFiltersChange}
      density="middle"
      onDensity={onDensity}
    />,
  );
  expect(screen.getByText("月份：2026-10")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "清除全部筛选" }));
  expect(onFiltersChange).toHaveBeenCalledWith({});
  fireEvent.click(screen.getByRole("radio", { name: "紧凑" }));
  expect(onDensity).toHaveBeenCalledWith("small");
});
