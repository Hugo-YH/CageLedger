import { Component, type ReactNode } from "react";

import { clearUiStorage } from "../../state/uiStorage";
import type { WorkspaceView } from "../../state/ui";

const CHUNK_RECOVERY_KEY = "cageledger.workspace.chunk-recovery-at";
const CHUNK_RECOVERY_WINDOW_MS = 30_000;

export function WorkspaceLoading() {
  return (
    <section className="workspace-view">
      <div className="empty-state" aria-busy="true">
        <strong>正在加载业务工作区...</strong>
      </div>
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
    if (!isChunkLoadFailure(error)) return;

    const lastRecoveryAt = Number(sessionStorage.getItem(CHUNK_RECOVERY_KEY) || 0);
    if (Date.now() - lastRecoveryAt < CHUNK_RECOVERY_WINDOW_MS) return;

    sessionStorage.setItem(CHUNK_RECOVERY_KEY, String(Date.now()));
    window.location.reload();
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
            <button className="secondary" type="button" onClick={() => window.location.reload()}>
              重新加载
            </button>
            <button
              className="primary"
              type="button"
              onClick={() => {
                clearUiStorage();
                sessionStorage.removeItem(CHUNK_RECOVERY_KEY);
                window.location.assign("/");
              }}
            >
              返回首页
            </button>
          </div>
        </div>
      </section>
    );
  }
}

function isChunkLoadFailure(error: Error) {
  return /chunkloaderror|loading chunk|dynamically imported module|module script/i.test(error.message);
}
