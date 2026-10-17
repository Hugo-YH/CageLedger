import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { DialogActivityContext } from "../../../state/dialogActivity";
import { SettlementNoticeModal } from "./SettlementNoticeModal";

const copy = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock("../../../utils/clipboard", () => ({ copyTextToClipboard: copy }));
vi.mock("../../../components/ui/Modal", () => ({
  Modal: ({ title, children }: { title?: ReactNode; children?: ReactNode }) => (
    <section>
      {title}
      {children}
    </section>
  ),
}));
afterEach(() => {
  cleanup();
  copy.mockReset();
});

const email = { subject: "结算通知", body: "待确认的结算邮件" };

function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("waits for the clipboard before confirming the active notice", async () => {
  const pending = deferred();
  copy.mockReturnValue(pending.promise);
  const onConfirm = vi.fn();
  render(<SettlementNoticeModal email={email} pending={false} onCancel={vi.fn()} onConfirm={onConfirm} />);
  fireEvent.click(screen.getByRole("button", { name: "复制并确认" }));
  expect(onConfirm).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve(true);
    await pending.promise;
  });
  expect(onConfirm).toHaveBeenCalledOnce();
});

it("never initiates from a clipboard result after the retained notice starts exiting", async () => {
  const pending = deferred();
  copy.mockReturnValue(pending.promise);
  const onConfirm = vi.fn();
  const view = (active: boolean) => (
    <DialogActivityContext.Provider value={active}>
      <SettlementNoticeModal email={email} pending={false} onCancel={vi.fn()} onConfirm={onConfirm} />
    </DialogActivityContext.Provider>
  );
  const { rerender } = render(view(true));
  fireEvent.click(screen.getByRole("button", { name: "复制并确认" }));
  rerender(view(false));
  // The component remains mounted while Ant plays the exit animation.
  expect(screen.getByText(email.body)).toBeInTheDocument();
  await act(async () => {
    pending.resolve(true);
    await pending.promise;
  });
  expect(onConfirm).not.toHaveBeenCalled();
});

it("preserves confirmation behavior when the clipboard fallback reports failure", async () => {
  copy.mockResolvedValue(false);
  const onConfirm = vi.fn();
  render(<SettlementNoticeModal email={email} pending={false} onCancel={vi.fn()} onConfirm={onConfirm} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "复制并确认" }));
    await Promise.resolve();
  });
  expect(onConfirm).toHaveBeenCalledOnce();
});
