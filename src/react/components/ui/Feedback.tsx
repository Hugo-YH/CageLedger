import { Alert, Result, Spin } from "antd";
import { type ReactNode } from "react";

export function Feedback({
  kind,
  title,
  detail,
  action,
}: {
  kind: "loading" | "empty" | "error" | "success";
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  if (kind === "loading")
    return (
      <Spin tip={title}>
        <div className="app-feedback-space" />
      </Spin>
    );
  if (kind === "empty") return <Result status="info" subTitle={detail} title={title} extra={action} />;
  return (
    <Alert action={action} description={detail} title={title} showIcon type={kind === "error" ? "error" : "success"} />
  );
}
