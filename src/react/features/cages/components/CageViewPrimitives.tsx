import { PageSkeleton } from "../../../components/WorkspaceUi";

export function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="legend-item">
      <i className={`status-dot ${tone}`} />
      {label}
    </span>
  );
}

export function CageLoading() {
  return <PageSkeleton label="笼位信息" rows={6} variant="detail" />;
}

export function CageEmpty() {
  return (
    <section className="workspace-view">
      <div className="empty-state">
        <h2>尚未创建饲养间</h2>
        <p>请先在房间管理中创建饲养间和笼架。</p>
      </div>
    </section>
  );
}
