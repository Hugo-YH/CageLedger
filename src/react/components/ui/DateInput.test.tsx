import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DateInput } from "./DateInput";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function EditingDate({ initial, picker }: { initial: string; picker: "date" | "month" }) {
  const [value, setValue] = useState(initial);
  const [feedback, setFeedback] = useState(0);
  return (
    <>
      <DateInput label="服务日期" value={value} onChange={setValue} picker={picker} required />
      <button onClick={() => setFeedback((current) => current + 1)}>更新反馈</button>
      <output aria-label="已确认日期">{value}</output>
      <output aria-label="反馈次数">{feedback}</output>
    </>
  );
}

it.each([
  ["date", "2096-04-01", "2096-04-03"],
  ["month", "2096-04", "2096-05"],
] as const)(
  "%s keeps uncommitted input through an unrelated parent update before Enter",
  async (picker, initial, typed) => {
    render(<EditingDate picker={picker} initial={initial} />);
    const input = screen.getByLabelText("服务日期");
    act(() => input.focus());
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: typed } });
    expect(input).toHaveValue(typed);
    fireEvent.click(screen.getByRole("button", { name: "更新反馈" }));
    expect(screen.getByLabelText("反馈次数")).toHaveTextContent("1");
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });
    await waitFor(() => expect(screen.getByLabelText("已确认日期")).toHaveTextContent(typed));
  },
);
