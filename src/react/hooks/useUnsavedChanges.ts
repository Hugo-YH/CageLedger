import { App } from "antd";
import { useCallback, useEffect, useRef } from "react";
import { useNavigationGuard } from "../state/ui";

/** Protect the local draft without persisting sensitive form data in browser storage. */
export function useUnsavedChanges(dirty: boolean, busy = false) {
  const { modal, message } = App.useApp();
  const guardRef = useNavigationGuard();
  const pending = useRef<Promise<boolean> | null>(null);
  const confirmLeave = useCallback(async () => {
    if (busy) {
      void message.info("正在保存或上传，请完成后再离开");
      return false;
    }
    if (!dirty) return true;
    if (!pending.current) {
      pending.current = Promise.resolve(
        modal.confirm({
          title: "离开并放弃未保存的修改？",
          content: "已保存的记录会保留。继续编辑可先保存当前修改。",
          okText: "放弃修改并离开",
          cancelText: "继续编辑",
          okButtonProps: { danger: true },
        }),
      )
        .then((confirmed) => Boolean(confirmed))
        .finally(() => {
          pending.current = null;
        });
    }
    return pending.current;
  }, [busy, dirty, message, modal]);
  useEffect(() => {
    if (!dirty && !busy) return;
    guardRef.current = confirmLeave;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      if (guardRef.current === confirmLeave) guardRef.current = null;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [busy, confirmLeave, dirty, guardRef]);
  return confirmLeave;
}
