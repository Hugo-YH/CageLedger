export function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="legend-item">
      <i className={`status-dot ${tone}`} />
      {label}
    </span>
  );
}

export function CageLoading() {
  return (
    <div className="empty-state" aria-busy="true">
      <h3>正在加载笼位信息...</h3>
    </div>
  );
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
