import { Empty } from "antd";
import type { ReactNode } from "react";

/** Keep the chart mounted inside its existing lazy boundary, with an explicit empty explanation. */
export function DashboardChartState({ message, children }: { message?: string; children: ReactNode }) {
  return (
    <div className="ant-dashboard-chart-frame">
      <div
        aria-hidden={message ? true : undefined}
        inert={message ? true : undefined}
        className={message ? "ant-dashboard-chart-empty-plot" : undefined}
      >
        {children}
      </div>
      {message ? (
        <Empty className="ant-dashboard-chart-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={message} />
      ) : null}
    </div>
  );
}
