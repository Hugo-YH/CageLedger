import { Component, type ReactNode } from "react";
import { Button } from "antd";

import { clearUiStorage } from "../../state/uiStorage";
import { claimChunkRecovery, clearChunkRecovery } from "../../state/chunkRecovery";
import type { WorkspaceView } from "../../state/ui";
import { PageSkeleton } from "../../components/PageSkeleton";

export function WorkspaceLoading() {
  return (
    <section className="workspace-view">
      <PageSkeleton label="业务工作区" variant="page" />
    </section>
  );
}

export class WorkspaceErrorBoundary extends Component<
  { children: ReactNode; resetKey: WorkspaceView },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (claimChunkRecovery(error)) window.location.reload();
  }

  componentDidUpdate(previousProps: Readonly<{ children: ReactNode; resetKey: WorkspaceView }>) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section className="workspace-view">
        <div className="empty-state" role="alert">
          <strong>当前工作区未能加载</strong>
          <span>页面资源可能刚完成更新，请重新加载后继续操作。</span>
          <div className="action-row">
            <Button onClick={() => window.location.reload()}>重新加载</Button>
            <Button
              type="primary"
              onClick={() => {
                clearUiStorage();
                clearChunkRecovery();
                window.location.assign("/");
              }}
            >
              返回首页
            </Button>
          </div>
        </div>
      </section>
    );
  }
}
