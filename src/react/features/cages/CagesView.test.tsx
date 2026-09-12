import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CageRack, CageSlot, PlacementTask } from "../../api/contracts";
import type { CommandBarProps } from "../../components/ui/CommandBar";
import type { ModalShell } from "../../components/WorkspaceUi";
import type * as CageWorkspaceComponents from "./components/CageWorkspaceComponents";
import type { PlacementDrawer, SlotEditor, VirtualRack } from "./components/CageWorkspaceComponents";
import { CagesView } from "./CagesView";

const { reserve, save, info } = vi.hoisted(() => ({ reserve: vi.fn(), save: vi.fn(), info: vi.fn() }));
const rooms = [
  { id: "room-1", name: "房间一" },
  { id: "room-2", name: "房间二" },
];
const racks: CageRack[] = [
  { id: "rack-1", roomId: "room-1", name: "笼架一", index: 1, rows: 1, cols: 2 },
  { id: "rack-2", roomId: "room-1", name: "笼架二", index: 2, rows: 1, cols: 1 },
  { id: "rack-3", roomId: "room-2", name: "笼架三", index: 1, rows: 1, cols: 1 },
];
const slots: CageSlot[] = [
  { id: "slot-1", rackId: "rack-1", row: 1, col: 1, status: "empty" },
  { id: "slot-2", rackId: "rack-1", row: 1, col: 2, status: "empty" },
  { id: "slot-3", rackId: "rack-2", row: 1, col: 1, status: "empty" },
  { id: "slot-4", rackId: "rack-3", row: 1, col: 1, status: "empty" },
];
const tasks: PlacementTask[] = [
  {
    id: "task-1",
    sourceBatchId: "batch-1",
    sourceReceiptId: "receipt-1",
    targetRoomId: "room-1",
    targetRoomName: "房间一",
    plannedMoveInDate: "2026-09-12",
    status: "pending",
    batchNo: "批次一",
    pi: "项目负责人",
    owner: "实验负责人",
  },
];

vi.mock("../../api/bootstrap", () => ({
  useBootstrap: () => ({
    data: { rooms, racks, slots, occupancies: [], placementTasks: tasks },
    isPending: false,
    isFetching: false,
  }),
}));
vi.mock("../../api/cages", () => ({
  useReservePlacement: () => ({ mutateAsync: reserve, isPending: false }),
  useSaveOccupancy: () => ({ mutateAsync: save, isPending: false }),
  useMoveInPlacement: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("antd", () => ({
  App: { useApp: () => ({ message: { info } }) },
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Select: ({
    options,
    value,
    onChange,
    ...props
  }: {
    options: Array<{ label: string; value: string }>;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <select {...props} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Empty: () => null,
  Alert: ({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) => (
    <div role="alert">
      {title}
      {description}
      {action}
    </div>
  ),
  Input: { TextArea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} /> },
}));
vi.mock("../../components/ui", () => ({
  ListRefreshStatus: ({ active }: { active: boolean }) => (active ? <div role="status">正在更新</div> : null),
  ActionButton: ({
    tone,
    loading,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: string; loading?: boolean }) => (
    <button {...props} data-tone={tone} data-loading={loading} />
  ),
}));
vi.mock("../../components/WorkspaceUi", () => ({
  PageState: ({ title, detail, retry }: { title: string; detail?: string; retry?: () => void }) => (
    <div role={retry ? "alert" : "status"}>
      {title}
      {detail}
      {retry ? <button onClick={retry}>重新加载</button> : null}
    </div>
  ),
  WorkspaceToolbar: ({ context, filters, actions, primaryAction, selection, ariaLabel }: CommandBarProps) => (
    <>
      <div>{filters}</div>
      <div aria-label={ariaLabel} role="group">
        {context}
        <span>已选 {selection?.count} 项</span>
        <button disabled={!selection?.count && !selection?.pending} onClick={selection?.onClear}>
          清空选择
        </button>
        {actions}
        {primaryAction}
      </div>
    </>
  ),
  ModalShell: ({ children, ariaLabel }: ComponentProps<typeof ModalShell>) => (
    <div role="dialog" aria-label={ariaLabel}>
      {children}
    </div>
  ),
}));
vi.mock("./components/CageFormControls", () => ({
  Field: ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => (
    <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
  SlotStatusSelect: () => null,
  SexSelect: () => null,
}));
vi.mock("./components/CageWorkspaceComponents", async (importOriginal) => ({
  ...(await importOriginal<typeof CageWorkspaceComponents>()),
  VirtualRack: ({ slots: visibleSlots, selectedSlotIds, onSelect }: ComponentProps<typeof VirtualRack>) => (
    <div>
      {visibleSlots.map((slot) => (
        <button key={slot.id} aria-pressed={selectedSlotIds.includes(slot.id)} onClick={() => onSelect(slot)}>
          {slot.id}
        </button>
      ))}
    </div>
  ),
  SlotEditor: ({ slot, onClose }: ComponentProps<typeof SlotEditor>) => (
    <div role="dialog" aria-label={`编辑 ${slot.id}`}>
      <button onClick={onClose}>关闭编辑</button>
    </div>
  ),
  PlacementDrawer: ({ tasks: visibleTasks, onSelect }: ComponentProps<typeof PlacementDrawer>) => (
    <div role="dialog" aria-label="待进驻动物">
      {visibleTasks.map((task) => (
        <button key={task.id} onClick={() => onSelect(task)}>
          {task.batchNo}
        </button>
      ))}
    </div>
  ),
}));

function changeScope(label: string, value: string) {
  fireEvent.change(screen.getByRole("combobox", { name: label }), { target: { value } });
}

function selectTask() {
  fireEvent.click(screen.getByRole("button", { name: "待进驻 1" }));
  fireEvent.click(screen.getByRole("button", { name: "批次一" }));
}

describe("cage workspace selection scope", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("clears multi-selection and the pending editor when changing racks", () => {
    render(<CagesView />);
    fireEvent.click(screen.getByRole("button", { name: "多选录入" }));
    fireEvent.click(screen.getByRole("button", { name: "全选当前" }));
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "批量编辑" }));
    expect(screen.getByRole("dialog", { name: "批量编辑 2 个笼位" })).toBeInTheDocument();
    changeScope("笼架", "rack-2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("已选 0 项")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批量编辑" })).toBeDisabled();
    expect(info).toHaveBeenCalledOnce();
  });

  it("clears single-selection and reservation targets when changing rooms or racks", () => {
    render(<CagesView />);
    fireEvent.click(screen.getByRole("button", { name: "slot-1" }));
    expect(screen.getByRole("dialog", { name: "编辑 slot-1" })).toBeInTheDocument();
    changeScope("房间", "room-2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(info).toHaveBeenCalledOnce();
    changeScope("房间", "room-1");
    selectTask();
    fireEvent.click(screen.getByRole("button", { name: "slot-1" }));
    expect(screen.getByRole("button", { name: "确认预留" })).toBeEnabled();
    changeScope("笼架", "rack-2");
    expect(screen.queryByRole("button", { name: "确认预留" })).not.toBeInTheDocument();
    expect(screen.getByText("已选 0 项")).toBeInTheDocument();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("can cancel a reservation before choosing a slot", () => {
    render(<CagesView />);
    selectTask();
    expect(screen.getByRole("button", { name: "确认预留" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "取消预留" }));
    expect(screen.queryByRole("button", { name: "确认预留" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "多选录入" })).toBeInTheDocument();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("keeps an initiated reservation snapshot while suppressing its stale UI completion", async () => {
    let finish!: () => void;
    reserve.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    render(<CagesView />);
    selectTask();
    fireEvent.click(screen.getByRole("button", { name: "slot-1" }));
    fireEvent.click(screen.getByRole("button", { name: "确认预留" }));
    expect(reserve).toHaveBeenCalledWith({ taskId: "task-1", slotId: "slot-1" });
    changeScope("笼架", "rack-2");
    fireEvent.click(screen.getByRole("button", { name: "多选录入" }));
    fireEvent.click(screen.getByRole("button", { name: "slot-3" }));
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
    expect(screen.queryByText(/已为 批次一 预留/)).not.toBeInTheDocument();
  });

  it("finishes every captured batch write after scope changes without clearing the new selection", async () => {
    let finish!: () => void;
    save
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValue(undefined);
    render(<CagesView />);
    fireEvent.click(screen.getByRole("button", { name: "多选录入" }));
    fireEvent.click(screen.getByRole("button", { name: "全选当前" }));
    fireEvent.click(screen.getByRole("button", { name: "批量编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "批量保存" }));
    changeScope("笼架", "rack-2");
    fireEvent.click(screen.getByRole("button", { name: "slot-3" }));
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(save.mock.calls.map(([payload]) => payload.item.slotId)).toEqual(["slot-1", "slot-2"]);
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
    expect(screen.queryByText("已批量保存 2 个笼位。")).not.toBeInTheDocument();
  });
});
