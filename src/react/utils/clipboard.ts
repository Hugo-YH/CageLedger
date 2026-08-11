/**
 * 将文本复制到系统剪贴板。
 * 优先使用 Clipboard API；非安全上下文（如内网 HTTP）下回退到
 * 临时 textarea + document.execCommand("copy")，保证普通 HTTP 页面也能复制。
 * 返回是否复制成功。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API 权限被拒时继续尝试同步回退。
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}
