import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { theme } from "antd";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { AntdProvider } from "./AntdProvider";

const preference = vi.hoisted(() => ({ reduced: false, theme: "light" }));
vi.mock("../../hooks/useMediaQuery", () => ({ useMediaQuery: () => preference.reduced }));
vi.mock("../../state/ui", () => ({ useResolvedTheme: () => preference.theme }));

afterEach(() => {
  cleanup();
  preference.reduced = false;
  preference.theme = "light";
});

function Draft() {
  const [value, setValue] = useState("");
  const { token } = theme.useToken();
  return (
    <>
      <input aria-label="未保存草稿" value={value} onChange={(event) => setValue(event.target.value)} />
      <output aria-label="组件动效">{String(token.motion)}</output>
    </>
  );
}

it("keeps the same focused draft mounted when live motion and theme preferences change", () => {
  const view = () => (
    <AntdProvider>
      <Draft />
    </AntdProvider>
  );
  const { rerender } = render(view());
  const input = screen.getByRole("textbox", { name: "未保存草稿" });
  fireEvent.change(input, { target: { value: "正在登记的检测资料" } });
  input.focus();
  expect(screen.getByLabelText("组件动效")).toHaveTextContent("true");

  for (const [reduced, mode] of [
    [true, "light"],
    [true, "dark"],
    [false, "dark"],
    [false, "light"],
  ] as const) {
    preference.reduced = reduced;
    preference.theme = mode;
    rerender(view());
    expect(screen.getByRole("textbox", { name: "未保存草稿" })).toBe(input);
    expect(input).toHaveValue("正在登记的检测资料");
    expect(input).toHaveFocus();
    expect(screen.getByLabelText("组件动效")).toHaveTextContent(String(!reduced));
  }
});
