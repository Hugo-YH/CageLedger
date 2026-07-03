import { useState } from "react";

import type { SessionUser } from "../../api/contracts";
import { useSystemInfo, useSystemUpdate } from "../../api/administration";
import { Pager, PageState, WorkspaceHeader } from "../../components/WorkspaceUi";
import { SYSTEM_RELEASE_NOTES, type ReleaseNote } from "../../releaseNotes";
import type { WorkspaceView } from "../../state/ui";
import { breadcrumb, settingsSwitchItems } from "../shell/workspaceNavigation";

export function SystemView({ user, navigate }: { user: SessionUser; navigate: (view: WorkspaceView) => void }) {
  const info = useSystemInfo();
  const [checkEnabled, setCheckEnabled] = useState(false);
  const [releasePage, setReleasePage] = useState(1);
  const [releasePageSize, setReleasePageSize] = useState(5);
  const update = useSystemUpdate(checkEnabled && user.role === "admin");
  if (info.isPending)
    return (
      <section className="workspace-view">
        <PageState title="正在加载系统信息..." />
      </section>
    );
  if (info.isError || !info.data)
    return (
      <section className="workspace-view">
        <PageState title="系统信息加载失败" retry={() => info.refetch()} />
      </section>
    );

  const data = info.data;
  const repository = data.repositoryUrl || "https://git.cellnucle.us/hugo/cageledger";
  const releasePages = Math.max(Math.ceil(SYSTEM_RELEASE_NOTES.length / releasePageSize), 1);
  const releaseItems = SYSTEM_RELEASE_NOTES.slice((releasePage - 1) * releasePageSize, releasePage * releasePageSize);

  return (
    <section className="workspace-view system-workspace">
      <WorkspaceHeader
        kicker="系统与文档工作台"
        title="关于系统"
        breadcrumbs={[breadcrumb("系统设置", () => navigate("rooms"))]}
        summary="集中查看当前版本、正式文档、发布记录和反馈入口。"
        status={`当前版本 v${data.version}`}
        switcherLabel="系统功能"
        switcherItems={settingsSwitchItems(navigate, user.role === "admin")}
      />
      <div className="workspace-body system-workspace-body">
        <div className="system-layout">
          <section className="panel large">
            <div className="panel-head">
              <div className="panel-title-line">
                <h2>系统状态</h2>
              </div>
              {user.role === "admin" ? (
                <div className="panel-head-actions">
                  <button
                    className="secondary info-button"
                    type="button"
                    disabled={update.isFetching}
                    onClick={() => {
                      setCheckEnabled(true);
                      if (checkEnabled) void update.refetch();
                    }}
                  >
                    检查更新
                  </button>
                </div>
              ) : null}
            </div>
            <div className="system-status-grid">
              <Status label="当前版本" value={`v${data.version}`} />
              <Status label="代码版本" value={data.revisionShort || "未设置"} />
              <Status label="所属单位" value={`${data.organization} · ${data.department}`} />
              <Status label="开源协议" value={data.license} />
            </div>
            {checkEnabled ? <UpdateCard update={update} /> : null}
            <section className="system-section">
              <div className="panel-head compact">
                <div className="panel-title-line">
                  <h2>更新记录</h2>
                </div>
                <div className="panel-head-actions">
                  <span className="panel-summary-chip">{SYSTEM_RELEASE_NOTES.length} 个版本</span>
                </div>
              </div>
              <div className="release-list">
                {releaseItems.map((note) => (
                  <ReleaseCard key={note.version} note={note} />
                ))}
              </div>
              <Pager
                page={releasePage}
                pages={releasePages}
                total={SYSTEM_RELEASE_NOTES.length}
                pageSize={releasePageSize}
                onPage={setReleasePage}
                onPageSize={(value) => {
                  setReleasePageSize(value);
                  setReleasePage(1);
                }}
              />
            </section>
            <section className="system-section">
              <div className="panel-head compact">
                <div className="panel-title-line">
                  <h2>维护信息</h2>
                </div>
              </div>
              <dl className="system-definition-list">
                <div>
                  <dt>开发维护</dt>
                  <dd>{data.developer}</dd>
                </div>
                <div>
                  <dt>联系邮箱</dt>
                  <dd>{data.contactEmail}</dd>
                </div>
                <div>
                  <dt>版权</dt>
                  <dd>{data.copyright}</dd>
                </div>
              </dl>
            </section>
          </section>
          <aside className="system-side">
            <section className="panel">
              <div className="panel-head compact">
                <div className="panel-title-line">
                  <h2>系统百科</h2>
                </div>
              </div>
              <p>使用、部署、权限、数据管理和开发规范统一维护在 Gitea Wiki。</p>
              <a className="doc-link" href={`${repository}/wiki`} target="_blank" rel="noreferrer">
                <strong>打开 CageLedger Wiki</strong>
                <span>查看全部正式文档</span>
              </a>
            </section>
            <section className="panel">
              <div className="panel-head compact">
                <div className="panel-title-line">
                  <h2>协同入口</h2>
                </div>
              </div>
              <div className="wiki-home-links">
                <a href="https://v.wjx.cn/vm/Y1pspgE.aspx#" target="_blank" rel="noreferrer">
                  提交问题与需求
                </a>
                <a href={`${repository}/projects`} target="_blank" rel="noreferrer">
                  项目看板
                </a>
                <a href={repository} target="_blank" rel="noreferrer">
                  代码仓库
                </a>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}

function UpdateCard({ update }: { update: ReturnType<typeof useSystemUpdate> }) {
  const status = update.isFetching
    ? "正在检查最新 Release"
    : update.data?.updateAvailable
      ? "发现新版本"
      : update.data?.disabled
        ? "更新检查已关闭"
        : "当前已是最新版本";
  return (
    <div className="rule-card update-card">
      <strong>{status}</strong>
      <span>{update.data?.latestVersion ? `最新发布版 v${update.data.latestVersion}` : "尚未获取远端版本"}</span>
      {update.data?.latestMessage ? <p>{update.data.latestMessage}</p> : null}
      {update.isError ? <p className="error-text">{update.error.message}</p> : null}
      {update.data?.latestUrl ? (
        <a href={update.data.latestUrl} target="_blank" rel="noreferrer">
          查看发布页
        </a>
      ) : null}
    </div>
  );
}

function ReleaseCard({ note }: { note: ReleaseNote }) {
  return (
    <article className="release-card">
      <div className="release-card-head">
        <strong>v{note.version}</strong>
        {note.releasedAt ? <time>{note.releasedAt}</time> : null}
      </div>
      <span>{note.title}</span>
      <ul>
        {note.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {note.note || note.notes ? <p className="release-note-meta">备注：{note.note || note.notes}</p> : null}
    </article>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-tile">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}
