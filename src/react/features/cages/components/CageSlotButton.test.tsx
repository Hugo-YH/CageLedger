import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { emptyOccupancy } from "../../../../domain/cages";
import { CageSlotButton } from "./CageSlotButton";

const formatNames = vi.hoisted(() => vi.fn((value: string) => value));
vi.mock("../../../../domain/personNames", () => ({ formatPersonNames: formatNames }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("reuses unchanged cell rendering while preserving selection, monkey age and the current callback", () => {
  const slot = { id: "slot", rackId: "rack", row: 1, col: 1, status: "active" as const };
  const rack = { id: "rack", roomId: "room", name: "笼架", index: 1, rows: 1, cols: 1 };
  const occupancy = {
    ...emptyOccupancy("slot", "A1", "2026-01-01"),
    pi: "PI",
    owner: "负责人",
    animalSex: "female",
    birthDate: "2024-01-15",
  };
  const first = vi.fn();
  const props = {
    slot,
    rack,
    roomName: "房间",
    roomSpecies: "monkey",
    occupancy,
    selected: false,
    today: "2026-07-02",
    onSelect: first,
  };
  const page = render(<CageSlotButton {...props} />);
  const renderedNames = formatNames.mock.calls.length;
  expect(screen.getByText("雌 · 2岁5月")).toBeInTheDocument();
  page.rerender(<CageSlotButton {...props} />);
  expect(formatNames).toHaveBeenCalledTimes(renderedNames);
  page.rerender(<CageSlotButton {...props} selected />);
  expect(screen.getByRole("button")).toHaveClass("selected");
  const current = vi.fn();
  page.rerender(<CageSlotButton {...props} selected onSelect={current} today="2026-08-02" />);
  expect(screen.getByText("雌 · 2岁6月")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button"));
  expect(current).toHaveBeenCalledExactlyOnceWith(slot);
  expect(first).not.toHaveBeenCalled();
});
