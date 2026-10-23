import { App } from "antd";
import { useEffect, useRef } from "react";

/** Scope excludes pagination and ordering; callers invalidate in-flight selection requests in reset. */
export function useSelectionScope(scopeKey: string, onReset: () => void, hasSelection: boolean) {
  const previousScope = useRef(scopeKey);
  const { message } = App.useApp();
  useEffect(() => {
    if (previousScope.current === scopeKey) return;
    previousScope.current = scopeKey;
    onReset();
    if (hasSelection) void message.info("范围已变化，已清空选择");
  }, [scopeKey, onReset, hasSelection, message]);
}
