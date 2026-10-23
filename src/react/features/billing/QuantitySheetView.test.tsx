import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuantitySheet } from "../../api/contracts";
import { QuantitySheetView } from "./QuantitySheetView";

const api = vi.hoisted(() => ({
  detail: {
    data: undefined as { item: QuantitySheet } | undefined,
    error: null as Error | null,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  },
  editingDialog: false,
  loadForEdit: vi.fn(),
  closeEditor: vi.fn(),
}));

vi.mock("../../api/quantitySheets", () => ({
  useQuantitySheetDetail: () => api.detail,
}));

vi.mock("./hooks/useQuantitySheetEditor", () => ({
  useQuantitySheetEditor: () => ({
    animalDetails: false,
    confirmSave: null,
    draft: { id: "draft", iacuc: "", month: "2026-10" },
    editingDialog: api.editingDialog,
    editorRows: [],
    initialLoading: false,
    loadForEdit: api.loadForEdit,
    closeEditor: api.closeEditor,
    persistSheet: vi.fn(),
    save: { isPending: false },
    selectedRoom: undefined,
    setConfirmSave: vi.fn(),
    setField: vi.fn(),
    startNew: vi.fn(),
    unit: "cage_day",
  }),
}));

vi.mock("./components/SavedQuantitySheets", () => ({
  SavedQuantitySheets: ({ onEdit }: { onEdit: (id: string) => void }) => (
    <button type="button" onClick={() => onEdit("sheet-1")}>
      编辑第一条
    </button>
  ),
}));

vi.mock("./components/QuantitySheetEditorForm", () => ({
  QuantitySheetEditorForm: () => <div>数量编辑器</div>,
}));

vi.mock("./components/QuantitySheetModals", () => ({ ConfirmSave: () => null }));

vi.mock("../../components/WorkspaceUi", () => ({
  AsyncActionButton: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  ModalShell: ({ children }: { children: ReactNode }) => <section role="dialog">{children}</section>,
  PageSkeleton: ({ label }: { label: string }) => <p>{label}加载中</p>,
  PageState: ({ title, retry }: { title: string; retry: () => void }) => (
    <div>
      <p>{title}</p>
      <button type="button" onClick={retry}>
        重试
      </button>
    </div>
  ),
}));

vi.mock("../../components/ui", () => ({
  ActionButton: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  CommandBar: () => null,
  ModalPresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const user = {
  id: "admin",
  username: "admin",
  displayName: "登记人员",
  phone: "",
  role: "admin" as const,
  roomIds: [],
  active: true,
  updatedAt: "2026-10-01",
};
const sheet = { id: "sheet-1", month: "2026-09", iacuc: "Z2026001" } as QuantitySheet;

describe("QuantitySheetView saved editor", () => {
  beforeEach(() => {
    api.detail = { data: undefined, error: null, isError: false, isPending: true, refetch: vi.fn() };
    api.editingDialog = false;
    api.loadForEdit.mockReset().mockImplementation(() => {
      api.editingDialog = true;
    });
    api.closeEditor.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens the edit dialog immediately and ignores a result that arrives after close", () => {
    const view = render(<QuantitySheetView user={user} mode="saved" />);
    fireEvent.click(screen.getByRole("button", { name: "编辑第一条" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("编辑数量统计表");
    expect(screen.getByText("编辑数量统计表加载中")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    api.detail = { ...api.detail, data: { item: sheet }, isPending: false };
    view.rerender(<QuantitySheetView user={user} mode="saved" />);
    expect(api.loadForEdit).not.toHaveBeenCalled();
  });

  it("keeps the dialog open for detail failure and retries before entering the existing editor", () => {
    const view = render(<QuantitySheetView user={user} mode="saved" />);
    fireEvent.click(screen.getByRole("button", { name: "编辑第一条" }));
    api.detail = { ...api.detail, error: new Error("读取失败"), isError: true, isPending: false };
    view.rerender(<QuantitySheetView user={user} mode="saved" />);
    expect(screen.getByText("数量统计表加载失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(api.detail.refetch).toHaveBeenCalledOnce();

    api.detail = { ...api.detail, data: { item: sheet }, error: null, isError: false };
    act(() => view.rerender(<QuantitySheetView user={user} mode="saved" />));
    expect(api.loadForEdit).toHaveBeenCalledWith(sheet);
    expect(screen.getByText("数量编辑器")).toBeInTheDocument();
  });
});
