import { ActionIcon } from "./ui/ActionIcon";
import { Component, type PropsWithChildren } from "react";
import { Button, Result } from "antd";

import { claimChunkRecovery } from "../state/chunkRecovery";
import { recordDiagnosticError } from "../diagnostics/collector";

/** Remains outside application providers so their initialization errors also get a recovery screen. */
export class AppErrorBoundary extends Component<PropsWithChildren, { error: Error | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    recordDiagnosticError(error, "react");
    if (claimChunkRecovery(error)) window.location.reload();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="react-load-error" role="alert">
        <Result
          status="error"
          title="页面未能加载"
          subTitle="请重新加载页面。若仍无法打开，请联系管理员检查浏览器错误和服务状态。"
          extra={
            <Button icon={<ActionIcon name="refresh" />} type="primary" onClick={() => window.location.reload()}>
              重新加载
            </Button>
          }
        />
      </main>
    );
  }
}
