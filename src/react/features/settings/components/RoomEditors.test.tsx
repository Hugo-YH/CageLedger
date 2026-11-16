import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UiProvider } from "../../../state/ui";
import { AntdProvider } from "../../../components/ui";
import { RoomEditor } from "./RoomEditors";
import { newRoomDraft } from "../model";

vi.mock("../../../hooks/useOperationFeedback", () => ({
  useOperationFeedback: () => ({ message: { info: vi.fn() } }),
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("confirms discarding a facility draft and blocks closing/editing during its write", async () => {
  let resolve!: () => void;
  const save = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const close = vi.fn();
  function Editor() {
    const [draft, setDraft] = useState(() => ({ ...newRoomDraft(), name: "原房间" }));
    return <RoomEditor draft={draft} pending={false} onChange={setDraft} onClose={close} onSave={save} />;
  }
  render(
    <UiProvider>
      <AntdProvider>
        <Editor />
      </AntdProvider>
    </UiProvider>,
  );
  const name = screen.getByRole("textbox", { name: "饲养间名称" });
  fireEvent.change(name, { target: { value: "未保存房间" } });
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await screen.findAllByText("离开并放弃未保存的修改？");
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(name).toHaveValue("未保存房间");
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "保存饲养间" }));
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  expect(name).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(close).not.toHaveBeenCalled();
  await act(async () => {
    resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledOnce();
});
