/** Open in the user's click; asynchronous save/fetch work must happen afterwards. */
export function openIntakePrintWindow() {
  const popup = window.open("", "_blank");
  if (!popup) return null;
  popup.document.write(
    '<!doctype html><html lang="zh-CN"><head><title>正在准备笼卡</title></head><body>正在准备笼卡...</body></html>',
  );
  popup.document.close();
  return popup;
}
