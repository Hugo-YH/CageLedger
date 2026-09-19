import { Spin } from "antd";

/** In-flow feedback; never places an interaction-blocking mask over retained rows. */
export function ListRefreshStatus({ active }: { active: boolean }) {
  return (
    <div className="app-list-refresh" data-ui="list-refresh" data-active={active} role="status" aria-live="polite">
      {active ? (
        <>
          <Spin size="small" />
          <span>正在更新，暂显示上次结果</span>
        </>
      ) : null}
    </div>
  );
}
