import { Alert, Spin } from "antd";
import { type ReactNode } from "react";
import { EmptyState } from "./EmptyState";

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
      <section aria-busy="true" aria-label={title} role="status">
        <Spin description={title}>
          <div className="app-feedback-space" />
        </Spin>
      </section>
    );
  if (kind === "empty") return <EmptyState title={title} detail={detail} action={action} />;
  return (
    <Alert action={action} description={detail} title={title} showIcon type={kind === "error" ? "error" : "success"} />
  );
}
