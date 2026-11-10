import { certificateFileError, certificateMultipleFilesError } from "./certificateDraft";

const representations = [
  { type: "application/pdf", mime: "application/pdf", extension: "pdf" },
  { type: "web application/pdf", mime: "application/pdf", extension: "pdf" },
  { type: "image/png", mime: "image/png", extension: "png" },
  { type: "image/jpeg", mime: "image/jpeg", extension: "jpg" },
  { type: "image/webp", mime: "image/webp", extension: "webp" },
];

export function certificatePastedFile(files: ArrayLike<File>) {
  if (files.length > 1) throw new Error(certificateMultipleFilesError);
  const file = files[0];
  if (!file) throw new Error("未发现 PDF 或图片文件，请复制合格证文件或图片后再粘贴，也可上传文件。");
  const error = certificateFileError(file);
  if (error) throw new Error(error);
  return file;
}

export async function readCertificateClipboard() {
  if (!window.isSecureContext || !navigator.clipboard?.read)
    throw new Error("当前环境无法直接读取剪贴板。请在下方粘贴 PDF 或图片，也可上传文件。");
  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new Error("未能读取剪贴板。请允许浏览器访问后重试，或在下方粘贴 PDF 或图片，也可上传文件。");
  }
  if (items.length > 1) throw new Error(certificateMultipleFilesError);
  const item = items[0];
  const representation = representations.find((candidate) => item?.types.includes(candidate.type));
  if (!item || !representation)
    throw new Error("剪贴板中没有可读取的 PDF 或图片。请在下方粘贴合格证文件，也可上传文件。");
  let blob: Blob;
  try {
    // One item may expose several versions of the same original. Prefer PDF so
    // its remaining pages are not silently replaced by an image representation.
    blob = await item.getType(representation.type);
  } catch {
    throw new Error("浏览器未能提供剪贴板原件。请在下方粘贴合格证文件，也可上传文件。");
  }
  return certificatePastedFile([
    new File([blob], `剪贴板合格证.${representation.extension}`, { type: representation.mime }),
  ]);
}
