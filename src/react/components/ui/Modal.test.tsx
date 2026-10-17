import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAsyncFormAction } from "../../hooks/useAsyncFormAction";
import { Modal } from "./Modal";
import { ModalPresence } from "./ModalPresence";

vi.mock("antd", () => ({
  Modal: ({
    afterClose,
    children,
    open,
    title,
  }: {
    afterClose?: () => void;
    children?: ReactNode;
    open?: boolean;
    title?: ReactNode;
  }) => (
    <section data-open={String(Boolean(open))} data-testid={`modal-${String(title)}`}>
      {children}
      <button aria-label={`完成 ${String(title)} 退场`} onClick={() => afterClose?.()}>
        完成退场
      </button>
    </section>
  ),
}));

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function DraftDialog({
  title,
  afterClose,
  children,
}: {
  title: string;
  afterClose?: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal open title={title} afterClose={afterClose}>
      {children ?? <DraftInput />}
    </Modal>
  );
}

function DraftInput() {
  const [value, setValue] = useState("");
  return <input aria-label="未保存草稿" value={value} onChange={(event) => setValue(event.target.value)} />;
}

function PresenceHost({ afterClose }: { afterClose?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(false)}>关闭弹窗</button>
      <ModalPresence>{open ? <DraftDialog key="draft" title="草稿" afterClose={afterClose} /> : null}</ModalPresence>
    </>
  );
}

describe("ModalPresence", () => {
  it("retains the last target props in a persistent Modal until Ant reports afterClose", () => {
    function PersistentTargetModal() {
      const [target, setTarget] = useState("批次 A");
      return (
        <>
          <button onClick={() => setTarget("")}>清空目标</button>
          <Modal open={Boolean(target)} title={target ? `编辑 ${target}` : ""}>
            {target ? <DraftInput /> : null}
          </Modal>
        </>
      );
    }

    render(<PersistentTargetModal />);
    const input = screen.getByRole("textbox", { name: "未保存草稿" });
    fireEvent.change(input, { target: { value: "待保存的批次说明" } });
    fireEvent.click(screen.getByRole("button", { name: "清空目标" }));

    expect(screen.getByTestId("modal-编辑 批次 A")).toHaveAttribute("data-open", "false");
    expect(screen.getByRole("textbox", { name: "未保存草稿" })).toBe(input);
    expect(input).toHaveValue("待保存的批次说明");

    fireEvent.click(screen.getByRole("button", { name: "完成 编辑 批次 A 退场" }));
    expect(screen.queryByTestId("modal-编辑 批次 A")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "未保存草稿" })).not.toBeInTheDocument();
  });

  it("invalidates an in-flight async success when a persistent Modal closes", async () => {
    const pending = deferred<string>();
    const onSuccess = vi.fn();
    function AsyncBody() {
      const action = useAsyncFormAction("保存失败");
      return <button onClick={() => void action.run(() => pending.promise, onSuccess)}>开始常驻保存</button>;
    }
    function PersistentAsyncModal() {
      const [target, setTarget] = useState("批次 A");
      return (
        <>
          <button onClick={() => setTarget("")}>关闭常驻弹窗</button>
          <Modal open={Boolean(target)} title={target ? `常驻 ${target}` : ""}>
            {target ? <AsyncBody /> : null}
          </Modal>
        </>
      );
    }

    render(<PersistentAsyncModal />);
    fireEvent.click(screen.getByRole("button", { name: "开始常驻保存" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭常驻弹窗" }));
    await act(async () => {
      pending.resolve("已完成");
      await pending.promise;
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("keeps the exiting draft in the DOM until Ant reports afterClose", () => {
    const afterClose = vi.fn();
    render(<PresenceHost afterClose={afterClose} />);
    const input = screen.getByRole("textbox", { name: "未保存草稿" });
    fireEvent.change(input, { target: { value: "尚未保存的检疫结论" } });

    fireEvent.click(screen.getByRole("button", { name: "关闭弹窗" }));
    expect(screen.getByTestId("modal-草稿")).toHaveAttribute("data-open", "false");
    expect(screen.getByRole("textbox", { name: "未保存草稿" })).toBe(input);
    expect(input).toHaveValue("尚未保存的检疫结论");
    expect(afterClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "完成 草稿 退场" }));
    expect(afterClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox", { name: "未保存草稿" })).not.toBeInTheDocument();
  });

  it("queues the latest different target until the current dialog exits", () => {
    function Switcher() {
      const [target, setTarget] = useState("one");
      return (
        <>
          <button onClick={() => setTarget("two")}>切换到 two</button>
          <button onClick={() => setTarget("three")}>切换到 three</button>
          <ModalPresence>{target ? <DraftDialog key={target} title={target} /> : null}</ModalPresence>
        </>
      );
    }

    render(<Switcher />);
    fireEvent.click(screen.getByRole("button", { name: "切换到 two" }));
    fireEvent.click(screen.getByRole("button", { name: "切换到 three" }));
    expect(screen.getByTestId("modal-one")).toHaveAttribute("data-open", "false");
    expect(screen.queryByTestId("modal-two")).not.toBeInTheDocument();
    expect(screen.queryByTestId("modal-three")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "完成 one 退场" }));
    expect(screen.queryByTestId("modal-one")).not.toBeInTheDocument();
    expect(screen.queryByTestId("modal-two")).not.toBeInTheDocument();
    expect(screen.getByTestId("modal-three")).toHaveAttribute("data-open", "true");
  });

  it("waits through a same-key reopen, then mounts a fresh draft after exit", () => {
    function Reopenable() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(false)}>关闭</button>
          <button onClick={() => setOpen(true)}>重新打开</button>
          <ModalPresence>{open ? <DraftDialog key="same" title="同一草稿" /> : null}</ModalPresence>
        </>
      );
    }

    render(<Reopenable />);
    const oldInput = screen.getByRole("textbox", { name: "未保存草稿" });
    fireEvent.change(oldInput, { target: { value: "旧草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "重新打开" }));

    expect(screen.getByTestId("modal-同一草稿")).toHaveAttribute("data-open", "false");
    expect(screen.getByRole("textbox", { name: "未保存草稿" })).toBe(oldInput);
    expect(oldInput).toHaveValue("旧草稿");

    fireEvent.click(screen.getByRole("button", { name: "完成 同一草稿 退场" }));
    const newInput = screen.getByRole("textbox", { name: "未保存草稿" });
    expect(screen.getByTestId("modal-同一草稿")).toHaveAttribute("data-open", "true");
    expect(newInput).not.toBe(oldInput);
    expect(newInput).toHaveValue("");
  });

  it("lets a nested confirmation complete without closing the outer presence", () => {
    function OuterDialog() {
      const [confirmOpen, setConfirmOpen] = useState(true);
      return (
        <Modal open title="外层">
          <DraftInput />
          <ModalPresence>{confirmOpen ? <DraftDialog key="confirm" title="确认" /> : null}</ModalPresence>
          <button onClick={() => setConfirmOpen(false)}>关闭确认</button>
        </Modal>
      );
    }

    render(
      <ModalPresence>
        <OuterDialog key="outer" />
      </ModalPresence>,
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭确认" }));
    fireEvent.click(screen.getByRole("button", { name: "完成 确认 退场" }));

    expect(screen.queryByTestId("modal-确认")).not.toBeInTheDocument();
    expect(screen.getByTestId("modal-外层")).toHaveAttribute("data-open", "true");
    expect(screen.getByRole("textbox", { name: "未保存草稿" })).toBeInTheDocument();
  });

  it("invalidates an in-flight async success as soon as the dialog begins exiting", async () => {
    const pending = deferred<string>();
    const onSuccess = vi.fn();
    function AsyncDialog() {
      const action = useAsyncFormAction("保存失败");
      return (
        <Modal open title="异步操作">
          <button onClick={() => void action.run(() => pending.promise, onSuccess)}>开始保存</button>
        </Modal>
      );
    }
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(false)}>关闭异步弹窗</button>
          <ModalPresence>{open ? <AsyncDialog key="async" /> : null}</ModalPresence>
        </>
      );
    }

    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "开始保存" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭异步弹窗" }));
    await act(async () => {
      pending.resolve("已完成");
      await pending.promise;
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("keeps an open dialog's local draft through ordinary parent renders", () => {
    function RedrawHost() {
      const [revision, setRevision] = useState(0);
      return (
        <>
          <button onClick={() => setRevision((value) => value + 1)}>重绘 {revision}</button>
          <ModalPresence>
            <DraftDialog key="live" title="持续打开">
              <DraftInput />
            </DraftDialog>
          </ModalPresence>
        </>
      );
    }

    render(<RedrawHost />);
    const input = screen.getByRole("textbox", { name: "未保存草稿" });
    fireEvent.change(input, { target: { value: "正在编辑" } });
    fireEvent.click(screen.getByRole("button", { name: "重绘 0" }));

    expect(screen.getByRole("textbox", { name: "未保存草稿" })).toBe(input);
    expect(input).toHaveValue("正在编辑");
    expect(screen.getByTestId("modal-持续打开")).toHaveAttribute("data-open", "true");
  });
});
