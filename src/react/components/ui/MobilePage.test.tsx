import { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MobilePage } from "./MobilePage";

afterEach(cleanup);

describe("responsive MobilePage", () => {
  it("preserves the body instance and unsaved input across desktop/mobile switches", () => {
    const mounted = vi.fn();
    function Draft() {
      const [value, setValue] = useState("");
      useEffect(() => {
        mounted();
      }, []);
      return <input aria-label="草稿" value={value} onChange={(event) => setValue(event.target.value)} />;
    }
    const desktop = {
      className: "workspace-view billing-workspace",
      bodyClassName: "workspace-body",
      feature: "billing",
      toolbar: <div>桌面操作栏</div>,
    };
    const { rerender } = render(
      <MobilePage title="统计表" desktop={desktop}>
        <Draft />
      </MobilePage>,
    );
    const field = screen.getByLabelText("草稿");
    fireEvent.change(field, { target: { value: "未保存的数据" } });
    rerender(
      <MobilePage title="统计表">
        <Draft />
      </MobilePage>,
    );
    expect(screen.getByLabelText("草稿")).toBe(field);
    expect(field).toHaveValue("未保存的数据");
    expect(screen.getByRole("heading", { name: "统计表" })).toBeVisible();
    rerender(
      <MobilePage title="统计表" desktop={desktop}>
        <Draft />
      </MobilePage>,
    );
    expect(screen.getByLabelText("草稿")).toBe(field);
    expect(field).toHaveValue("未保存的数据");
    expect(mounted).toHaveBeenCalledTimes(1);
  });
});
