import { App } from "antd";
import { useEffect, useEffectEvent, useRef } from "react";

/** Scope excludes pagination and ordering; callers invalidate in-flight selection requests in reset. */
export function useSelectionScope(scopeKey: string, onReset: () => void, hasSelection: boolean) {
  const previousScope = useRef(scopeKey);
  const { message } = App.useApp();
  const reset = useEffectEvent(() => {
    onReset();
    if (hasSelection) void message.info("范围已变化，已清空选择");
  });
  useEffect(() => {
    if (previousScope.current === scopeKey) return;
    previousScope.current = scopeKey;
    reset();
  }, [scopeKey]);
}
