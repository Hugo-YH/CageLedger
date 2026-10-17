import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Drawer } from "./Drawer";
import { ModalPresence } from "./ModalPresence";

vi.mock("antd", () => ({
  Drawer: ({
    afterOpenChange,
    children,
    drawerRender,
    open,
    title,
  }: {
    afterOpenChange?: (open: boolean) => void;
    children?: ReactNode;
    drawerRender?: (node: ReactNode) => ReactNode;
    open?: boolean;
    title?: ReactNode;
  }) => {
    const panel = <div data-testid={`drawer-panel-${String(title)}`}>{children}</div>;
    return (
      <section data-open={String(Boolean(open))} data-testid={`drawer-${String(title)}`}>
        {drawerRender ? drawerRender(panel) : panel}
        <button aria-label={`完成 ${String(title)} 打开`} onClick={() => afterOpenChange?.(true)}>
          完成打开
        </button>
        <button aria-label={`完成 ${String(title)} 关闭`} onClick={() => afterOpenChange?.(false)}>
          完成关闭
        </button>
      </section>
    );
  },
}));

afterEach(cleanup);

function DraftInput() {
  const [value, setValue] = useState("");
  return <input aria-label="抽屉草稿" value={value} onChange={(event) => setValue(event.target.value)} />;
}

function DraftDrawer({ title, afterOpenChange }: { title: string; afterOpenChange?: (open: boolean) => void }) {
  return (
    <Drawer open title={title} afterOpenChange={afterOpenChange}>
      <DraftInput />
    </Drawer>
  );
}

describe("Drawer", () => {
  it("keeps a conditionally mounted drawer through Ant's close completion", () => {
    const afterOpenChange = vi.fn();
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(false)}>关闭抽屉</button>
          <ModalPresence>
            {open ? <DraftDrawer key="draft" title="草稿抽屉" afterOpenChange={afterOpenChange} /> : null}
          </ModalPresence>
        </>
      );
    }

    render(<Host />);
    const input = screen.getByRole("textbox", { name: "抽屉草稿" });
    fireEvent.change(input, { target: { value: "未保存的导入范围" } });
    fireEvent.click(screen.getByRole("button", { name: "完成 草稿抽屉 打开" }));
    expect(afterOpenChange).toHaveBeenCalledExactlyOnceWith(true);
    afterOpenChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "关闭抽屉" }));

    expect(screen.getByTestId("drawer-草稿抽屉")).toHaveAttribute("data-open", "false");
    expect(screen.getByTestId("drawer-panel-草稿抽屉")).toHaveAttribute("inert");
    expect(screen.getByRole("textbox", { name: "抽屉草稿" })).toBe(input);
    expect(input).toHaveValue("未保存的导入范围");
    expect(afterOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "完成 草稿抽屉 关闭" }));
    expect(afterOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.queryByRole("textbox", { name: "抽屉草稿" })).not.toBeInTheDocument();
  });

  it("retains a persistent target drawer's visual props until close completes", () => {
    const afterOpenChange = vi.fn();
    function PersistentDrawer() {
      const [target, setTarget] = useState("导入历史工单");
      return (
        <>
          <button onClick={() => setTarget("")}>清空抽屉目标</button>
          <Drawer
            open={Boolean(target)}
            title={target}
            afterOpenChange={afterOpenChange}
            drawerRender={(node) => <div data-testid="custom-drawer-render">{node}</div>}
          >
            {target ? <DraftInput /> : null}
          </Drawer>
        </>
      );
    }

    render(<PersistentDrawer />);
    const input = screen.getByRole("textbox", { name: "抽屉草稿" });
    fireEvent.change(input, { target: { value: "待导入 3 条" } });
    fireEvent.click(screen.getByRole("button", { name: "清空抽屉目标" }));

    expect(screen.getByTestId("drawer-导入历史工单")).toHaveAttribute("data-open", "false");
    expect(screen.getByTestId("custom-drawer-render")).toContainElement(input);
    expect(input).toHaveValue("待导入 3 条");

    fireEvent.click(screen.getByRole("button", { name: "完成 导入历史工单 关闭" }));
    expect(afterOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.queryByRole("textbox", { name: "抽屉草稿" })).not.toBeInTheDocument();
  });

  it("does not let a nested drawer completion finish its outer presence", () => {
    function OuterDrawer() {
      const [innerOpen, setInnerOpen] = useState(true);
      return (
        <Drawer open title="外层抽屉">
          <DraftInput />
          <button onClick={() => setInnerOpen(false)}>关闭内层抽屉</button>
          <ModalPresence>{innerOpen ? <DraftDrawer key="inner" title="内层抽屉" /> : null}</ModalPresence>
        </Drawer>
      );
    }

    render(
      <ModalPresence>
        <OuterDrawer key="outer" />
      </ModalPresence>,
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭内层抽屉" }));
    fireEvent.click(screen.getByRole("button", { name: "完成 内层抽屉 关闭" }));

    expect(screen.queryByTestId("drawer-内层抽屉")).not.toBeInTheDocument();
    expect(screen.getByTestId("drawer-外层抽屉")).toHaveAttribute("data-open", "true");
    expect(screen.getByRole("textbox", { name: "抽屉草稿" })).toBeInTheDocument();
  });
});
