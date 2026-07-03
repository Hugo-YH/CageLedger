import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { uploadFile, useIacucStatus, usePrincipalIdentities, useSavePrincipalIdentity } from "../../api/administration";
import type { PrincipalIdentity, SessionUser } from "../../api/contracts";
import { queryKeys } from "../../api/queryKeys";
import { formatDateTime, PageState, WorkspaceHeader } from "../../components/WorkspaceUi";
import type { WorkspaceView } from "../../state/ui";
import { breadcrumb, settingsSwitchItems } from "../shell/workspaceNavigation";

export function DataView({ user, navigate }: { user: SessionUser; navigate: (view: WorkspaceView) => void }) {
  const status = useIacucStatus();
  const identities = usePrincipalIdentities();
  const saveIdentity = useSavePrincipalIdentity();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState("");
  const rows = (identities.data?.items || []).filter((item) =>
    item.pi.toLocaleLowerCase("zh-CN").includes(filter.trim().toLocaleLowerCase("zh-CN")),
  );
  async function upload(kind: "iacuc" | "monthly" | "arrears", file?: File) {
    if (!file) return;
    setUploading(kind);
    try {
      const endpoint = kind === "iacuc" ? "/api/iacuc-index/upload" : `/api/reimbursement-records/import-${kind}`;
      const result = await uploadFile<{ count?: number }>(endpoint, file);
      setNotice(`${file.name} 已处理，共 ${result.count ?? 0} 条记录。`);
      if (kind === "iacuc") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.iacucStatus });
        void queryClient.invalidateQueries({ queryKey: queryKeys.principalIdentities });
      } else void queryClient.invalidateQueries({ queryKey: queryKeys.reimbursementRoot });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "文件处理失败");
    } finally {
      setUploading("");
    }
  }
  return (
    <section className="workspace-view settings-workspace">
      <WorkspaceHeader
        kicker="数据治理工作台"
        title="数据管理"
        breadcrumbs={[breadcrumb("系统设置", () => navigate("rooms"))]}
        summary="维护 IACUC 索引、负责人身份和历史报销台账，保障录入与结算自动匹配。"
        status={`${status.data?.count || 0} 条 IACUC`}
        switcherLabel="系统功能"
        switcherItems={settingsSwitchItems(navigate, user.role === "admin")}
      />
      <div className="workspace-body settings-workspace-body">
        {notice ? (
          <div className="react-inline-notice" role="status">
            {notice}
          </div>
        ) : null}
        <section className="settings-split-layout data-settings-layout">
          <div className="panel large">
            <div className="panel-head">
              <div className="panel-title-line">
                <h2>项目负责人身份</h2>
                <p>负责人身份决定每日免费笼数额度。</p>
              </div>
              <div className="panel-head-actions">
                <input
                  className="compact-search"
                  type="search"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="检索负责人"
                />
              </div>
            </div>
            {identities.isPending ? (
              <PageState title="正在加载负责人身份..." />
            ) : identities.isError ? (
              <PageState title="负责人身份加载失败" retry={() => identities.refetch()} />
            ) : (
              <div className="table-wrap" role="region" tabIndex={0} aria-label="项目负责人身份列表">
                <table className="dense-table">
                  <thead>
                    <tr>
                      <th>项目负责人</th>
                      <th>负责人身份</th>
                      <th>免费笼数/天</th>
                      <th>更新时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length ? (
                      rows.map((item) => (
                        <IdentityRow
                          key={item.pi}
                          item={item}
                          disabled={user.role !== "admin"}
                          pending={saveIdentity.isPending}
                          onSave={(next) => saveIdentity.mutateAsync(next)}
                        />
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5}>当前没有匹配的项目负责人。</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <aside className="settings-side-stack">
            <section className="panel">
              <div className="panel-head compact">
                <div className="panel-title-line">
                  <h2>IACUC 索引</h2>
                </div>
              </div>
              {status.isPending ? (
                <PageState title="正在读取索引状态..." />
              ) : (
                <div className="rule-card">
                  <strong>{status.data?.count || 0} 条记录</strong>
                  <span>
                    {status.data?.updatedAt ? `最后更新 ${formatDateTime(status.data.updatedAt)}` : "尚未上传索引"}
                  </span>
                  <p>索引用于自动匹配项目名称、负责人、实验负责人和支撑经费。</p>
                </div>
              )}
              {user.role === "admin" ? (
                <FileAction
                  label="上传 IACUC CSV"
                  accept=".csv,text/csv"
                  pending={uploading === "iacuc"}
                  onFile={(file) => void upload("iacuc", file)}
                />
              ) : null}
            </section>
            {user.role === "admin" ? (
              <section className="panel">
                <div className="panel-head compact">
                  <div className="panel-title-line">
                    <h2>历史报销台账导入</h2>
                  </div>
                </div>
                <div className="data-import-stack">
                  <FileAction
                    label="导入月汇总 Excel"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    pending={uploading === "monthly"}
                    onFile={(file) => void upload("monthly", file)}
                  />
                  <FileAction
                    label="导入欠缴汇算 Excel"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    pending={uploading === "arrears"}
                    onFile={(file) => void upload("arrears", file)}
                  />
                </div>
              </section>
            ) : null}
          </aside>
        </section>
      </div>
    </section>
  );
}

function IdentityRow({
  item,
  disabled,
  pending,
  onSave,
}: {
  item: PrincipalIdentity;
  disabled: boolean;
  pending: boolean;
  onSave: (item: PrincipalIdentity) => Promise<unknown>;
}) {
  const [type, setType] = useState(item.principalType);
  const allowance = type === "pi" ? 20 : 10;
  return (
    <tr>
      <td>{item.pi}</td>
      <td>
        <select
          value={type}
          disabled={disabled}
          onChange={(event) => setType(event.target.value as PrincipalIdentity["principalType"])}
        >
          <option value="independent">独立科研人员</option>
          <option value="pi">PI</option>
        </select>
      </td>
      <td>{allowance}</td>
      <td>{formatDateTime(item.updatedAt)}</td>
      <td>
        <button
          className="secondary info-button compact"
          type="button"
          disabled={disabled || pending}
          onClick={() => void onSave({ ...item, principalType: type, freeCageAllowance: allowance })}
        >
          保存
        </button>
      </td>
    </tr>
  );
}

function FileAction({
  label,
  accept,
  pending,
  onFile,
}: {
  label: string;
  accept: string;
  pending: boolean;
  onFile: (file?: File) => void;
}) {
  return (
    <label className="file-action">
      <span>{pending ? "正在处理..." : label}</span>
      <input type="file" accept={accept} disabled={pending} onChange={(event) => onFile(event.target.files?.[0])} />
    </label>
  );
}
