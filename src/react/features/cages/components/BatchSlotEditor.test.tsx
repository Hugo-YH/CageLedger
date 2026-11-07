import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { CageRack, CageSlot, Occupancy } from "../../../api/contracts";
import { BatchSlotEditor } from "./BatchSlotEditor";
import { useBatchSlotOperation } from "./useBatchSlotOperation";

const { save, refresh } = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined) }));
const feedback = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock("../../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => feedback }));
vi.mock("../../../api/cages", () => ({
  useSaveOccupancy: () => ({ mutateAsync: save, isPending: false }),
  useRefreshCageRoom: () => refresh,
}));
vi.mock("../../../components/WorkspaceUi", () => ({ ModalShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("../../../components/ui", () => ({
  ActionButton: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("./CageFormControls", () => ({
  Field: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
  }) => (
    <input aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
  ),
  SlotStatusSelect: () => null,
}));
vi.mock("antd", () => ({
  Alert: ({ title }: { title: ReactNode }) => <div role="alert">{title}</div>,
  Input: { TextArea: () => null },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps a partial write visible and does not report the whole batch as saved", async () => {
  const rack: CageRack = { id: "rack", roomId: "room", name: "笼架", index: 1, rows: 1, cols: 2 };
  const slots: CageSlot[] = [1, 2].map((col) => ({ id: `slot-${col}`, rackId: "rack", row: 1, col, status: "empty" }));
  const done = vi.fn();
  save.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("记录版本冲突"));
  render(
    <BatchSlotEditor
      slots={slots}
      rack={rack}
      roomName="房间"
      roomId="room"
      occupancies={[]}
      onClose={vi.fn()}
      onDone={done}
      beginOperation={() => () => true}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "批量保存" }));
  await screen.findByText("已处理 1 个笼位；后续操作未完成：记录版本冲突");
  expect(save).toHaveBeenCalledTimes(2);
  expect(feedback.warning).toHaveBeenCalledOnce();
  expect(done).not.toHaveBeenCalled();
});

const rack: CageRack = { id: "rack", roomId: "room", name: "笼架", index: 1, rows: 1, cols: 3 };
const slots: CageSlot[] = [1, 2, 3].map((col) => ({
  id: `slot-${col}`,
  rackId: "rack",
  row: 1,
  col,
  status: "active",
}));
function occupancy(number: number): Occupancy {
  return {
    id: `occupancy-${number}`,
    slotId: `slot-${number}`,
    cageCode: `笼-${number}`,
    status: "active",
    iacuc: `IACUC-${number}`,
    project: "项目",
    pi: "PI",
    owner: "负责人",
    startDate: "2026-11-01",
    endDate: "",
    notes: "",
    updatedAt: `2026-11-07T00:00:0${number}.123456+00:00`,
  };
}

it("retains exact versions and retries only the unfinished frozen items after partial success", async () => {
  const done = vi.fn();
  const originals = slots.map((_, index) => occupancy(index + 1));
  save
    .mockImplementationOnce(({ item }: { item: Occupancy }) =>
      Promise.resolve({ item: { ...item, updatedAt: "server-new-1" } }),
    )
    .mockRejectedValueOnce(new Error("连接中断"));
  const props = {
    slots,
    rack,
    occupancies: originals,
    roomId: "room",
    roomName: "房间",
    onClose: vi.fn(),
    onDone: done,
    beginOperation: () => () => true,
  };
  const page = render(<BatchSlotEditor {...props} />);
  fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "本次固定项目" } });
  fireEvent.click(screen.getByRole("button", { name: "批量保存" }));
  await screen.findByText("已处理 1 个笼位；后续操作未完成：连接中断");
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("项目名称")).toBeDisabled();
  page.rerender(
    <BatchSlotEditor
      {...props}
      occupancies={[{ ...originals[0], project: "后台新项目", updatedAt: "server-new-1" }, ...originals.slice(1)]}
    />,
  );
  expect(screen.getByLabelText("项目名称")).toHaveValue("本次固定项目");
  save.mockImplementation(({ item }: { item: Occupancy }) =>
    Promise.resolve({ item: { ...item, updatedAt: "server-confirmed" } }),
  );
  fireEvent.click(screen.getByRole("button", { name: "继续批量保存" }));
  await waitFor(() => expect(done).toHaveBeenCalledWith("已批量保存 3 个笼位。"));
  expect(save.mock.calls.map(([input]) => input.item.id)).toEqual([
    "occupancy-1",
    "occupancy-2",
    "occupancy-2",
    "occupancy-3",
  ]);
  expect(
    save.mock.calls.every(([input]) => input.deferInvalidate === true && input.item.project === "本次固定项目"),
  ).toBe(true);
  expect(save.mock.calls.map(([input]) => input.item.updatedAt)).toEqual([
    originals[0].updatedAt,
    originals[1].updatedAt,
    originals[1].updatedAt,
    originals[2].updatedAt,
  ]);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("locks the whole serial job synchronously and stays busy through its sole final refresh", async () => {
  let finish!: (value: { item: Occupancy }) => void;
  let finishRefresh!: () => void;
  save
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ item: { ...occupancy(2), updatedAt: "server-2" } });
  refresh.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishRefresh = resolve;
      }),
  );
  const done = vi.fn();
  const prepare = vi.fn(() => [1, 2].map((number) => ({ item: occupancy(number), exists: true })));
  const hook = renderHook(() => useBatchSlotOperation("room", () => () => true, done));
  let running!: Promise<void>;
  act(() => {
    running = hook.result.current.run("save", prepare);
    void hook.result.current.run("save", prepare);
  });
  expect(save).toHaveBeenCalledOnce();
  expect(prepare).toHaveBeenCalledOnce();
  await act(async () => {
    finish({ item: { ...occupancy(1), updatedAt: "server-1" } });
    await Promise.resolve();
  });
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledTimes(2);
  expect(hook.result.current.busy).toBe(true);
  expect(hook.result.current.job?.receipts.map((item) => item.updatedAt)).toEqual(["server-1", "server-2"]);
  expect(done).not.toHaveBeenCalled();
  await act(async () => {
    finishRefresh();
    await running;
  });
  expect(hook.result.current.busy).toBe(false);
  expect(done).toHaveBeenCalledOnce();
});

it("ends occupied slots using their original versions and refreshes once while skipping empty slots", async () => {
  save.mockImplementation(({ item }: { item: Occupancy }) =>
    Promise.resolve({ item: { ...item, updatedAt: "ended-version" } }),
  );
  const done = vi.fn();
  render(
    <BatchSlotEditor
      slots={slots.slice(0, 2)}
      rack={rack}
      occupancies={[occupancy(1)]}
      roomId="room"
      roomName="房间"
      onClose={vi.fn()}
      onDone={done}
      beginOperation={() => () => true}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "批量设为空" }));
  fireEvent.click(screen.getByRole("button", { name: "再次点击确认批量设空" }));
  await waitFor(() => expect(done).toHaveBeenCalledWith("已将 2 个笼位设为空。"));
  expect(save).toHaveBeenCalledExactlyOnceWith({
    item: expect.objectContaining({ id: "occupancy-1", status: "ended", updatedAt: occupancy(1).updatedAt }),
    exists: true,
    deferInvalidate: true,
  });
  expect(refresh).toHaveBeenCalledOnce();
});
