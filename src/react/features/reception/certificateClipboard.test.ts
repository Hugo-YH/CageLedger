import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { certificatePastedFile, readCertificateClipboard } from "./certificateClipboard";

const read = vi.fn<() => Promise<ClipboardItems>>();
function item(types: string[]) {
  return {
    types,
    presentationStyle: "unspecified" as const,
    getType: vi.fn<(type: string) => Promise<Blob>>().mockResolvedValue(new Blob(["original"])),
  };
}

beforeEach(() => {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", { clipboard: { read } });
  read.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("certificate clipboard originals", () => {
  it.each(["application/pdf", "web application/pdf"])(
    "prefers %s over another representation of one item",
    async (pdf) => {
      const original = item(["image/png", pdf, "text/html"]);
      read.mockResolvedValue([original]);
      const file = await readCertificateClipboard();
      expect(original.getType).toHaveBeenCalledExactlyOnceWith(pdf);
      expect(file).toMatchObject({ name: "剪贴板合格证.pdf", type: "application/pdf", size: 8 });
    },
  );

  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
  ])("reads %s when a PDF is not exposed", async (mime, extension) => {
    const original = item(["text/html", mime]);
    read.mockResolvedValue([original]);
    expect(await readCertificateClipboard()).toMatchObject({ name: `剪贴板合格证.${extension}`, type: mime, size: 8 });
    expect(original.getType).toHaveBeenCalledExactlyOnceWith(mime);
  });

  it("rejects several clipboard items before reading any one of them", async () => {
    const originals = [item(["application/pdf"]), item(["image/png"])];
    read.mockResolvedValue(originals);
    await expect(readCertificateClipboard()).rejects.toThrow("逐份上传");
    originals.forEach((original) => expect(original.getType).not.toHaveBeenCalled());
  });

  it("does not replace an unreadable PDF with its image representation", async () => {
    const original = item(["application/pdf", "image/png"]);
    vi.mocked(original.getType).mockRejectedValue(new Error("custom format unavailable"));
    read.mockResolvedValue([original]);
    await expect(readCertificateClipboard()).rejects.toThrow("粘贴合格证文件");
    expect(original.getType).toHaveBeenCalledExactlyOnceWith("application/pdf");
  });

  it("requires a secure supported clipboard reader and gives a paste fallback on permission failure", async () => {
    vi.stubGlobal("isSecureContext", false);
    await expect(readCertificateClipboard()).rejects.toThrow("在下方粘贴");
    expect(read).not.toHaveBeenCalled();
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {});
    await expect(readCertificateClipboard()).rejects.toThrow("在下方粘贴");
    vi.stubGlobal("navigator", { clipboard: { read } });
    read.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    await expect(readCertificateClipboard()).rejects.toThrow("允许浏览器访问后重试");
  });

  it("does not treat copied text or a URL as an original", async () => {
    const original = item(["text/plain", "text/html", "text/uri-list"]);
    read.mockResolvedValue([original]);
    await expect(readCertificateClipboard()).rejects.toThrow("没有可读取的 PDF 或图片");
    expect(original.getType).not.toHaveBeenCalled();
    expect(() => certificatePastedFile([])).toThrow("未发现 PDF 或图片文件");
  });

  it("keeps a native pasted file unchanged and rejects multiple or unsupported files", () => {
    const original = new File(["original"], "original.png", { type: "image/png" });
    expect(certificatePastedFile([original])).toBe(original);
    expect(() => certificatePastedFile([original, original])).toThrow("逐份上传");
    expect(() => certificatePastedFile([new File(["image"], "original.gif", { type: "image/gif" })])).toThrow(
      "PDF、PNG、JPEG 或 WebP",
    );
  });
});
