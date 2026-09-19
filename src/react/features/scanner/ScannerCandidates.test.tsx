import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScannerChoices } from "./frozenQr";
import { ScannerCandidates } from "./ScannerCandidates";

const choices: ScannerChoices = {
  frame: "data:image/jpeg;base64,frozen",
  width: 800,
  height: 600,
  complete: true,
  candidates: [
    {
      code: { data: "https://example.org/c/AB12" },
      corners: [
        { x: 100, y: 100 },
        { x: 260, y: 120 },
        { x: 240, y: 280 },
        { x: 80, y: 260 },
      ],
    },
    {
      code: { data: "CD34" },
      corners: [
        { x: 540, y: 300 },
        { x: 700, y: 280 },
        { x: 720, y: 440 },
        { x: 560, y: 460 },
      ],
    },
  ],
};
afterEach(cleanup);

describe("frozen camera code choices", () => {
  it("numbers every detected code and ties each outline and numbered option to the same choice", () => {
    const onSelect = vi.fn();
    const { container } = render(<ScannerCandidates choices={choices} onSelect={onSelect} />);
    expect(screen.getByRole("group", { name: "选择笼卡二维码" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("识别到 2 个二维码，请点选");
    expect(screen.getByRole("img")).toHaveAttribute("src", choices.frame);
    const outlines = container.querySelectorAll("polygon");
    expect(outlines).toHaveLength(2);
    expect(outlines[0]).toHaveAttribute("points", "100,100 260,120 240,280 80,260");
    expect(outlines[1]).toHaveAttribute("points", "540,300 700,280 720,440 560,460");
    fireEvent.click(screen.getByRole("button", { name: "选择二维码 2" }));
    fireEvent.click(screen.getByRole("button", { name: "查看二维码 1：AB12" }));
    expect(onSelect.mock.calls).toEqual([[1], [0]]);
  });

  it("focuses a named native button and preserves ordinary keyboard navigation and activation", () => {
    const onSelect = vi.fn();
    render(<ScannerCandidates choices={choices} onSelect={onSelect} />);
    const first = screen.getByRole("button", { name: "选择二维码 1" });
    expect(first).toHaveFocus();
    for (const button of screen.getAllByRole("button")) {
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
      expect(button.tabIndex).toBe(0);
    }
    const second = screen.getByRole("button", { name: "查看二维码 2：CD34" });
    second.focus();
    expect(second).toHaveFocus();
    // Native keyboard activation dispatches a click with detail 0. Browser tests
    // cover actual Tab / Enter because jsdom does not implement default key actions.
    fireEvent.click(second, { detail: 0 });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("fits outlines to the frozen frame's aspect ratio without stretching a landscape frame", () => {
    render(<ScannerCandidates choices={choices} onSelect={vi.fn()} />);
    const first = screen.getByRole("button", { name: "选择二维码 1" });
    expect(first.parentElement).toHaveStyle({ width: "100%", height: "75%", left: "0%", top: "12.5%" });
    expect(first).toHaveStyle({ left: "10%", width: "22.5%", height: "30%" });
    expect(parseFloat(first.style.top)).toBeCloseTo(16.6667, 4);
  });

  it("allows a numbered selection when the frozen picture cannot be produced", () => {
    const onSelect = vi.fn();
    render(<ScannerCandidates choices={{ ...choices, frame: "" }} onSelect={onSelect} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("无法显示冻结画面，请从下方选择二维码。")).toBeVisible();
    expect(screen.getByRole("button", { name: "查看二维码 1：AB12" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "查看二维码 2：CD34" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("does not fabricate a box when a decoded code has no reliable corners", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ScannerCandidates
        choices={{ ...choices, candidates: [{ code: { data: "AB12" }, corners: null }], complete: false }}
        onSelect={onSelect}
      />,
    );
    expect(container.querySelector("polygon")).toBeNull();
    expect(screen.queryByRole("button", { name: "选择二维码 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("未框出的可重新对准扫描");
    fireEvent.click(screen.getByRole("button", { name: "查看二维码 1：AB12" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("keeps full code text accessible when a long numbered label is shortened visually", () => {
    const longCode = "A".repeat(90);
    render(
      <ScannerCandidates
        choices={{ ...choices, frame: "", candidates: [{ code: { data: longCode }, corners: null }] }}
        onSelect={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: `查看二维码 1：${longCode}` });
    expect(button).toHaveAttribute("title", longCode);
    expect(button.textContent).toBe(`1 · ${"A".repeat(48)}…`);
  });
});
