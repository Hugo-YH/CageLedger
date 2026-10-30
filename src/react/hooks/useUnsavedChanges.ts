import { App } from "antd";
import { useCallback, useContext, useEffect, useRef } from "react";
import { useNavigationGuard, type NavigationGuardOptions } from "../state/ui";
import { DialogActivityContext } from "../state/dialogActivity";

/** Protect the local draft without persisting sensitive form data in browser storage. */
export function useUnsavedChanges(dirty: boolean, busy = false) {
  const active = useContext(DialogActivityContext);
  const { modal, message } = App.useApp();
  const guardRef = useNavigationGuard();
  const pending = useRef<Promise<boolean> | null>(null);
  const approvedUnload = useRef(false);
  const confirmLeave = useCallback(
    async (options?: NavigationGuardOptions) => {
      if (!active) return true;
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
      const confirmed = await pending.current;
      if (confirmed && options?.documentUnload) approvedUnload.current = true;
      return confirmed;
    },
    [active, busy, dirty, message, modal],
  );
  useEffect(() => {
    if (!active || (!dirty && !busy)) return;
    guardRef.current = confirmLeave;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      // Only the immediate, explicitly confirmed document navigation may pass.
      // Consume the approval so a cancelled unload cannot weaken future protection.
      if (approvedUnload.current) {
        approvedUnload.current = false;
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      if (guardRef.current === confirmLeave) guardRef.current = null;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [active, busy, confirmLeave, dirty, guardRef]);
  return confirmLeave;
}
