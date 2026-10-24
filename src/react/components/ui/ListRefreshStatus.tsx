import { Spin } from "antd";
import { useEffect, useState } from "react";

/** In-flow feedback; never places an interaction-blocking mask over retained rows. */
export function ListRefreshStatus({ active }: { active: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active) {
      setReady(false);
      return;
    }
    const timer = window.setTimeout(() => setReady(true), 200);
    return () => window.clearTimeout(timer);
  }, [active]);
  const shown = active && ready;
  return (
    <div
      className="app-list-refresh"
      data-ui="list-refresh"
      data-active={shown}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {shown ? (
        <>
          <Spin size="small" />
          <span>正在更新，暂显示上次结果</span>
        </>
      ) : null}
    </div>
  );
}
