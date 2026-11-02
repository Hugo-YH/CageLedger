import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { CageRack, CageSlot } from "../../../api/contracts";
import { BatchSlotEditor } from "./BatchSlotEditor";

const save = vi.hoisted(() => vi.fn());
const feedback = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock("../../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => feedback }));
vi.mock("../../../api/cages", () => ({ useSaveOccupancy: () => ({ mutateAsync: save, isPending: false }) }));
vi.mock("../../../components/WorkspaceUi", () => ({ ModalShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("../../../components/ui", () => ({
  ActionButton: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("./CageFormControls", () => ({ Field: () => null, SlotStatusSelect: () => null }));
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
