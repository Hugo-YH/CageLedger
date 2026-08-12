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
    // 保持 1px 大小位于视口左上角：屏幕外或完全透明的元素在 Safari/iOS
    // 上无法进入选中状态，execCommand 复制会失败。
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.padding = "0";
    textarea.style.border = "0";
    textarea.style.outline = "none";
    textarea.style.boxShadow = "none";
    textarea.style.background = "transparent";
    textarea.style.opacity = "0.01";
    textarea.style.fontSize = "12pt";
    textarea.style.userSelect = "text";
    document.body.appendChild(textarea);
    // Firefox 需要先聚焦再选中，execCommand("copy") 才会真正写入剪贴板。
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}
