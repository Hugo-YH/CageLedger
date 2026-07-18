import type { SessionUser } from "../../api/contracts";
import { useAnimalInspectionCatalog } from "../../api/animalManagement";
import { PageState, WorkspaceHeader } from "../../components/WorkspaceUi";
import type { WorkspaceView } from "../../state/ui";
import { breadcrumb } from "../shell/workspaceNavigation";
import { catalogItems } from "./model";

export function InspectionStandards({
  user,
  navigate,
}: {
  user: SessionUser;
  navigate: (view: WorkspaceView) => void;
}) {
  const catalog = useAnimalInspectionCatalog();
  if (catalog.isLoading) return <PageState title="正在加载巡检标准..." />;
  if (catalog.isError || !catalog.data)
    return <PageState title="巡检标准加载失败" retry={() => void catalog.refetch()} />;
  return (
    <section className="workspace-view animal-management-workspace">
      <WorkspaceHeader
        kicker="动物管理工作台"
        title="巡检标准"
        summary="评分标准以受控目录版本发布，历史巡检记录持续保留提交时的评分语义。"
        breadcrumbs={[breadcrumb("动物管理", () => navigate("animal-inspection-entry"))]}
        status={catalog.data.version.status === "active" ? "当前生效" : catalog.data.version.status}
      />
      <div className="workspace-body animal-management-body">
        <section className="panel inspection-standards-panel">
          <div className="inspection-catalog-banner">
            <div>
              <span>当前目录版本</span>
              <strong>{catalog.data.version.version}</strong>
              <small>{catalog.data.version.source}</small>
            </div>
            <div>
              <span>导入时间</span>
              <strong>{catalog.data.version.imported_at.replace("T", " ").slice(0, 16)}</strong>
              <small>
                {user.role === "admin"
                  ? "系统管理员可在受控导入流程中审核后发布新版本。"
                  : "当前版本由系统管理员维护。"}
              </small>
            </div>
          </div>
          <p className="inspection-review-notice">{catalog.data.reviewNotice}</p>
          <div className="inspection-standard-grid">
            {catalog.data.modules.map((module) => (
              <article key={module.code}>
                <span>评分模块</span>
                <h2>{module.name}</h2>
                <p>{module.description}</p>
                <strong>{catalogItems(catalog.data.nodes, module.code).length} 个评分条目</strong>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
