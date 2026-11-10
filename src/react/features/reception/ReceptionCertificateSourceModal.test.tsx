import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ModalProps } from "antd";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AntdProvider } from "../../components/ui";
import type * as UiModule from "../../components/ui";
import { DialogActivityContext } from "../../state/dialogActivity";
import { UiProvider } from "../../state/ui";
import { readCertificateClipboard } from "./certificateClipboard";
import type * as ClipboardModule from "./certificateClipboard";
import { ReceptionCertificateSourceModal } from "./ReceptionCertificateSourceModal";

vi.mock("../../components/ui", async (load) => {
  const actual = await load<typeof UiModule>();
  return {
    ...actual,
    Modal: ({ children, title, footer }: ModalProps) => (
      <section role="dialog" aria-label={String(title)}>
        {children}
        {typeof footer === "function" ? null : footer}
      </section>
    ),
  };
});
vi.mock("./certificateClipboard", async (load) => {
  const actual = await load<typeof ClipboardModule>();
  return { ...actual, readCertificateClipboard: vi.fn() };
});

const file = new File(["original"], "certificate.png", { type: "image/png" });
const onFile = vi.fn<(file: File) => boolean | void>();
const onClose = vi.fn();
function view(active = true) {
  return (
    <UiProvider>
      <AntdProvider>
        <DialogActivityContext.Provider value={active}>
          <ReceptionCertificateSourceModal onFile={onFile} onClose={onClose} />
        </DialogActivityContext.Provider>
      </AntdProvider>
    </UiProvider>
  );
}
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  onFile.mockReset();
  onClose.mockReset();
  vi.mocked(readCertificateClipboard).mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens a system picker only after choosing upload and keeps the source dialog after cancelling it", () => {
  const chooser = vi.spyOn(HTMLInputElement.prototype, "click");
  render(view());
  expect(chooser).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "上传文件" }));
  expect(chooser).toHaveBeenCalledOnce();
  const input = screen.getByLabelText("选择待识别合格证文件");
  expect(input).toHaveAttribute("accept", expect.stringContaining("image/webp"));
  fireEvent(input, new Event("cancel"));
  expect(screen.getByRole("dialog", { name: "选择合格证来源" })).toBeInTheDocument();
  expect(onFile).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { files: [file] } });
  expect(onFile).toHaveBeenCalledExactlyOnceWith(file);
  chooser.mockRestore();
});

it("passes a single native pasted image through and gives a local error for several files or copied text", () => {
  render(view());
  const paste = screen.getByRole("textbox", { name: "粘贴合格证 PDF 或图片" });
  fireEvent.paste(paste, { clipboardData: { files: [file, file] } });
  expect(screen.getByRole("alert")).toHaveTextContent("逐份上传");
  expect(onFile).not.toHaveBeenCalled();
  fireEvent.paste(paste, { clipboardData: { files: [], getData: () => "file:///private/certificate.pdf" } });
  expect(screen.getByRole("alert")).toHaveTextContent("未发现 PDF 或图片文件");
  expect(onFile).not.toHaveBeenCalled();
  fireEvent.paste(paste, { clipboardData: { files: [file] } });
  expect(onFile).toHaveBeenCalledExactlyOnceWith(file);
});

it("keeps paste and upload available after clipboard failure and focuses paste after loading ends", async () => {
  vi.mocked(readCertificateClipboard).mockRejectedValue(new Error("请在下方粘贴 PDF 或图片"));
  render(view());
  fireEvent.click(screen.getByRole("button", { name: "读取剪贴板" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("请在下方粘贴 PDF 或图片");
  const paste = screen.getByRole("textbox", { name: "粘贴合格证 PDF 或图片" });
  await waitFor(() => expect(paste).toHaveFocus());
  expect(screen.getByRole("button", { name: "上传文件" })).toBeEnabled();
  vi.mocked(readCertificateClipboard).mockResolvedValue(file);
  fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
  await waitFor(() => expect(onFile).toHaveBeenCalledExactlyOnceWith(file));
});

it.each(["cancel", "retire"])(
  "ignores a late clipboard result after %s and prevents overlapping reads",
  async (end) => {
    let finish: (file: File) => void = () => {};
    vi.mocked(readCertificateClipboard).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const rendered = render(view());
    const read = screen.getByRole("button", { name: "读取剪贴板" });
    fireEvent.click(read);
    fireEvent.click(read);
    expect(readCertificateClipboard).toHaveBeenCalledOnce();
    if (end === "cancel") fireEvent.click(screen.getByRole("button", { name: "取消" }));
    else rendered.rerender(view(false));
    await act(() => Promise.resolve().then(() => finish(file)));
    expect(onFile).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(end === "cancel" ? 1 : 0);
  },
);

it("recovers when the list or permission rejects a selected original", () => {
  onFile.mockReturnValueOnce(false);
  render(view());
  const paste = screen.getByRole("textbox", { name: "粘贴合格证 PDF 或图片" });
  fireEvent.paste(paste, { clipboardData: { files: [file] } });
  expect(screen.getByRole("alert")).toHaveTextContent("请刷新列表后重新选择原件");
  fireEvent.paste(paste, { clipboardData: { files: [file] } });
  expect(onFile).toHaveBeenCalledTimes(2);
});
