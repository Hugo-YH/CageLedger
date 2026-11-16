import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { FindingCaptureDialog } from "./InspectionDialogs";
import type { InspectionCatalogNode } from "../../api/contracts";

vi.mock("../../components/ui/Modal", () => ({
  Modal: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <section role="dialog">
      {children}
      {footer}
    </section>
  ),
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("exposes a photo picker, keeps earlier selections, and excludes unsupported files from confirmation", async () => {
  const confirm = vi.fn();
  render(
    <FindingCaptureDialog
      node={{ code: "a", name: "异常指标", config: {} } as InspectionCatalogNode}
      onClose={vi.fn()}
      onConfirm={confirm}
      onReference={vi.fn()}
    />,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "选择现场照片" })).toBeVisible());
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("缺少照片选择器");
  const first = new File(["image-1"], "现场1.png", { type: "image/png" });
  const second = new File(["image-2"], "现场2.jpg", { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [first] } });
  await screen.findByText("现场1.png");
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [second] } });
  await screen.findByText("现场2.jpg");
  expect(screen.getByText("现场1.png")).toBeInTheDocument();
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, {
    target: { files: [new File(["bad"], "bad.pdf", { type: "application/pdf" })] },
  });
  await screen.findByText("请选择非空的 JPEG、PNG 或 WebP 图片，单张不超过 10 MiB。");
  fireEvent.click(screen.getByRole("button", { name: "确认异常" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ files: [first, second] })));
});
