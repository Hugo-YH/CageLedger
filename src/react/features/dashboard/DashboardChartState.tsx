import { Empty } from "antd";
import { useEffect, useState, type ReactNode } from "react";

/** Defer the first plot until it has data; keep an initialized plot through later empty states. */
export function DashboardChartState({
  message,
  height,
  children,
}: {
  message?: string;
  height: number;
  children: ReactNode;
}) {
  const [initialized, setInitialized] = useState(!message);
  useEffect(() => {
    if (!message) setInitialized(true);
  }, [message]);
  return (
    <div className="ant-dashboard-chart-frame" style={{ minHeight: height }}>
      <div
        aria-hidden={message ? true : undefined}
        inert={message ? true : undefined}
        className={message ? "ant-dashboard-chart-empty-plot" : undefined}
      >
        {initialized || !message ? children : null}
      </div>
      {message ? (
        <Empty className="ant-dashboard-chart-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={message} />
      ) : null}
    </div>
  );
}
