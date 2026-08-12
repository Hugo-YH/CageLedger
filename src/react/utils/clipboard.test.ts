import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "./clipboard";

function setClipboardApi(writeText?: (...args: unknown[]) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

function setExecCommand(impl: () => boolean) {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: impl,
  });
}

describe("copyTextToClipboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("copies via Clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboardApi(writeText);

    await expect(copyTextToClipboard("通知正文")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("通知正文");
  });

  it("falls back to execCommand when Clipboard API is unavailable", async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus").mockImplementation(() => {});
    setClipboardApi(undefined);
    setExecCommand(execCommand);

    await expect(copyTextToClipboard("邮件内容")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(focus).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector("textarea")).toBeNull();
  });

  it("falls back to execCommand when Clipboard API rejects", async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    setClipboardApi(vi.fn().mockRejectedValue(new Error("denied")));
    setExecCommand(execCommand);

    await expect(copyTextToClipboard("邮件内容")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("returns false when no copy path works", async () => {
    setClipboardApi(undefined);
    setExecCommand(() => false);

    await expect(copyTextToClipboard("邮件内容")).resolves.toBe(false);
  });
});
