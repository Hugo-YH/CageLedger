import type { ButtonHTMLAttributes, ComponentProps } from "react";
import type * as Antd from "antd";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CageRack, CageSlot, PlacementTask, SessionUser } from "../../api/contracts";
import type { CommandBarProps } from "../../components/ui/CommandBar";
import type { ModalShell } from "../../components/WorkspaceUi";
import type * as CageWorkspaceComponents from "./components/CageWorkspaceComponents";
import type { PlacementDrawer, SlotEditor } from "./components/CageWorkspaceComponents";
import { CagesView } from "./CagesView";

const operationFeedback = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  message: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => operationFeedback }));
vi.mock("../../hooks/useUnsavedChanges", () => ({ useUnsavedChanges: () => () => Promise.resolve(true) }));

const { reserve, save, info } = vi.hoisted(() => ({ reserve: vi.fn(), save: vi.fn(), info: vi.fn() }));
const user: SessionUser = {
  id: "admin",
  username: "admin",
  displayName: "系统管理员",
  phone: "",
  active: true,
  role: "admin",
  roomIds: [],
  updatedAt: "",
};
const rooms = [
  { id: "room-1", name: "房间一" },
  { id: "room-2", name: "房间二", facility: "bioisland" },
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

vi.mock("../../api/infrastructure", () => ({
  useRooms: () => ({ data: { items: rooms }, isPending: false, isFetching: false }),
  useRoomWorkspace: (roomId: string) => ({
    data: roomId ? { rooms, racks, slots, occupancies: [], placementTasks: tasks } : undefined,
    isPending: !roomId,
    isFetching: false,
  }),
}));
vi.mock("../../api/cages", () => ({
  useReservePlacement: () => ({ mutateAsync: reserve, isPending: false }),
  useSaveOccupancy: () => ({ mutateAsync: save, isPending: false }),
  useRefreshCageRoom: () => () => Promise.resolve(),
  useMoveInPlacement: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("antd", async (importOriginal) => ({
  ...(await importOriginal<typeof Antd>()),
  App: { useApp: () => ({ message: { info } }) },
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Typography: { Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span> },
  Select: ({
    options,
    value,
    onChange,
    onSelect,
    loading,
    ...props
  }: {
    options: Array<{ label: string; value: string }>;
    value: string;
    loading?: boolean;
    onChange?: (value: string) => void;
    onSelect?: (value: string) => void;
  }) => (
    <select
      {...props}
      aria-busy={loading}
      value={value}
      onChange={(event) => (onChange ?? onSelect)?.(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
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
  // Modal/Drawer tests cover visual exit retention; this suite isolates selection scope.
  ModalPresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ListRefreshStatus: ({ active }: { active: boolean }) => (active ? <div role="status">正在更新</div> : null),
  HelpPopover: ({ label }: { label: string }) => <button aria-label={label} type="button" />,
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

function changeRoom(value: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "房间" }), { target: { value } });
}

function renderRoom() {
  render(<CagesView user={user} />);
  changeRoom("room-1");
}

function chooseRack(name: string) {
  const map = screen.getByRole("region", { name: "房间笼架布局" });
  fireEvent.click(within(map).getByRole("button", { name: new RegExp(`^${name}，`) }));
}

function closeRack() {
  fireEvent.click(screen.getByRole("button", { name: "恢复房间图比例" }));
}

function chooseSlot(code: string) {
  const map = screen.getByRole("region", { name: "房间笼架布局" });
  fireEvent.click(within(map).getByRole("button", { name: new RegExp(`^${code}，`) }));
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

  it("filters authorized rooms by facility and keeps the current room when clearing the filter", () => {
    render(<CagesView user={user} />);
    const facility = screen.getByRole("combobox", { name: "设施" });
    const room = screen.getByRole("combobox", { name: "房间" });
    expect(facility).toHaveValue("");
    expect(room).toHaveValue("");
    expect(screen.queryByRole("region", { name: "房间笼架布局" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "多选录入" })).toBeDisabled();
    fireEvent.change(facility, { target: { value: "bioisland" } });
    expect(room).toHaveValue("");
    expect(within(room).queryByRole("option", { name: "房间一" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "房间笼架布局" })).not.toBeInTheDocument();
    changeRoom("room-2");
    expect(screen.getByRole("button", { name: "恢复房间图比例" })).toHaveTextContent("100%");
    expect(screen.getByRole("button", { name: /^笼架三，/ })).toBeInTheDocument();

    fireEvent.change(facility, { target: { value: "" } });
    expect(room).toHaveValue("room-2");
    expect(within(room).getByRole("option", { name: "房间一" })).toBeInTheDocument();

    fireEvent.change(facility, { target: { value: "zhujiang" } });
    expect(room).toHaveValue("");
    expect(screen.queryByRole("region", { name: "房间笼架布局" })).not.toBeInTheDocument();
  });

  it("clears multi-selection and the pending editor when changing racks", () => {
    renderRoom();
    expect(screen.queryByRole("combobox", { name: "笼架" })).not.toBeInTheDocument();
    chooseRack("笼架一");
    expect(screen.getByRole("button", { name: /^笼架一，/ })).toHaveFocus();
    expect(screen.getByRole("button", { name: /^笼架一，/ })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "多选录入" }));
    const selectAll = screen.getByRole("button", { name: "全选当前" });
    expect(selectAll).toBeDisabled();
    expect(screen.queryByRole("region", { name: /笼位详情$/ })).not.toBeInTheDocument();
    chooseRack("笼架一");
    expect(selectAll).toBeEnabled();
    fireEvent.click(selectAll);
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "批量编辑" }));
    expect(screen.getByRole("dialog", { name: "批量编辑 2 个笼位" })).toBeInTheDocument();
    closeRack();
    chooseRack("笼架二");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("已选 0 项")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批量编辑" })).toBeDisabled();
    expect(operationFeedback.message.info).toHaveBeenCalledOnce();
  });

  it("clears the selected slot across racks and keeps the placement task within its room", () => {
    renderRoom();
    expect(screen.queryByRole("region", { name: "笼架一 笼位详情" })).not.toBeInTheDocument();
    chooseRack("笼架一");
    expect(screen.getByRole("button", { name: "恢复房间图比例" })).toHaveTextContent("300%");
    expect(screen.queryByRole("region", { name: "笼架一 笼位详情" })).not.toBeInTheDocument();
    chooseSlot("房间一-01-A1");
    expect(screen.getByRole("dialog", { name: "编辑 slot-1" })).toBeInTheDocument();
    changeRoom("room-2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(operationFeedback.message.info).toHaveBeenCalledOnce();
    changeRoom("room-1");
    selectTask();
    const confirm = screen.getByRole("button", { name: "确认预留" });
    expect(confirm).toBeDisabled();
    expect(screen.queryByRole("region", { name: /笼位详情$/ })).not.toBeInTheDocument();
    chooseRack("笼架一");
    chooseSlot("房间一-01-A1");
    expect(confirm).toBeEnabled();
    closeRack();
    chooseRack("笼架二");
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消预留" })).toBeInTheDocument();
    expect(screen.getByText("已选 0 项")).toBeInTheDocument();
    chooseSlot("房间一-02-A1");
    expect(confirm).toBeEnabled();
    changeRoom("room-2");
    expect(screen.queryByRole("button", { name: "确认预留" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /笼位详情$/ })).not.toBeInTheDocument();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("can cancel a reservation before choosing a slot", () => {
    renderRoom();
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
    renderRoom();
    selectTask();
    chooseRack("笼架一");
    chooseSlot("房间一-01-A1");
    fireEvent.click(screen.getByRole("button", { name: "确认预留" }));
    expect(reserve).toHaveBeenCalledWith({ taskId: "task-1", slotId: "slot-1" });
    closeRack();
    chooseRack("笼架二");
    fireEvent.click(screen.getByRole("button", { name: "取消预留" }));
    fireEvent.click(screen.getByRole("button", { name: "多选录入" }));
    chooseSlot("房间一-02-A1");
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
    renderRoom();
    fireEvent.click(screen.getByRole("button", { name: "多选录入" }));
    chooseRack("笼架一");
    fireEvent.click(screen.getByRole("button", { name: "全选当前" }));
    fireEvent.click(screen.getByRole("button", { name: "批量编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "批量保存" }));
    chooseSlot("房间一-02-A1");
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(save.mock.calls.map(([payload]) => payload.item.slotId)).toEqual(["slot-1", "slot-2"]);
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
    expect(screen.queryByText("已批量保存 2 个笼位。")).not.toBeInTheDocument();
  });

  it("does not close a reopened batch editor when a previously closed job finishes in the same scope", async () => {
    let finish!: () => void;
    save.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve))).mockResolvedValue(undefined);
    renderRoom();
    fireEvent.click(screen.getByRole("button", { name: "多选录入" }));
    chooseRack("笼架一");
    fireEvent.click(screen.getByRole("button", { name: "全选当前" }));
    fireEvent.click(screen.getByRole("button", { name: "批量编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "批量保存" }));
    fireEvent.click(screen.getByRole("button", { name: "清空选择" }));
    chooseSlot("房间一-01-B1");
    fireEvent.click(screen.getByRole("button", { name: "批量编辑" }));
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(save.mock.calls.map(([payload]) => payload.item.slotId)).toEqual(["slot-1", "slot-2"]);
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "批量编辑 1 个笼位" })).toBeInTheDocument();
    expect(operationFeedback.success).not.toHaveBeenCalled();
  });
});
