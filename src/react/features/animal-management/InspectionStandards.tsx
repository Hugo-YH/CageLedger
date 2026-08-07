import { useState } from "react";
import { Alert, Button, Card, Col, Descriptions, Row, Space, Tag, Typography } from "antd";

import type { SessionUser } from "../../api/contracts";
import { useAnimalInspectionCatalog, useAnimalInspectionCatalogDraft } from "../../api/animalManagement";
import { PageState } from "../../components/WorkspaceUi";
import { MobilePage } from "../../components/ui/MobilePage";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";
import type { WorkspaceView } from "../../state/ui";
import { InspectionCatalogEditor } from "./InspectionCatalogEditor";
import { InspectionVersionHistoryModal } from "./InspectionVersionHistoryModal";
import { moduleItemCount } from "./model";

export function InspectionStandards({
  user,
  navigate,
}: {
  user: SessionUser;
  navigate: (view: WorkspaceView) => void;
}) {
  const isMobile = useIsMobileLayout();
  const isAdmin = user.role === "admin";
  const [editing, setEditing] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const catalog = useAnimalInspectionCatalog();
  const draft = useAnimalInspectionCatalogDraft(isAdmin);
  if (catalog.isLoading) return <PageState title="正在加载巡检标准..." />;
  if (catalog.isError || !catalog.data)
    return <PageState title="巡检标准加载失败" retry={() => void catalog.refetch()} />;
  if (editing) {
    if (draft.isLoading || !draft.data) return <PageState title="正在加载编辑草稿..." />;
    const editor = <InspectionCatalogEditor draft={draft.data} onExit={() => setEditing(false)} />;
    if (isMobile) {
      return (
        <MobilePage onBack={() => navigate("animal-inspection-entry")} title="巡检标准">
          {editor}
        </MobilePage>
      );
    }
    return (
      <section className="workspace-view animal-management-workspace" data-feature="animal-management">
        <div className="workspace-body animal-management-body">{editor}</div>
      </section>
    );
  }
  const content = (
    <>
      {draft.data?.hasDraft ? (
        <Alert
          className="inspection-draft-banner"
          type="info"
          showIcon
          title="存在未发布的草稿"
          description="当前目录已有保存但未发布的修改，发布后录入表单与标准页将同步更新。"
          action={
            <Button size="small" type="primary" onClick={() => setEditing(true)}>
              继续编辑
            </Button>
          }
        />
      ) : null}
      <Card
        className="animal-ant-card inspection-standards-panel"
        extra={
          <Space>
            <Tag color={catalog.data.version.status === "active" ? "green" : "default"}>
              {catalog.data.version.status === "active" ? "当前生效" : catalog.data.version.status}
            </Tag>
            {isAdmin ? (
              <Space>
                <Button size="small" onClick={() => setVersionsOpen(true)}>
                  版本历史
                </Button>
                <Button size="small" type="primary" onClick={() => setEditing(true)}>
                  编辑目录
                </Button>
              </Space>
            ) : null}
          </Space>
        }
        title="巡检标准目录"
      >
        <Descriptions bordered className="inspection-catalog-summary" column={{ xs: 1, sm: 2 }} size="small">
          <Descriptions.Item label="当前目录版本">{catalog.data.version.version}</Descriptions.Item>
          <Descriptions.Item label="导入时间">
            {catalog.data.version.imported_at.replace("T", " ").slice(0, 16)}
          </Descriptions.Item>
          <Descriptions.Item label="来源">{catalog.data.version.source}</Descriptions.Item>
        </Descriptions>
        <Alert
          className="inspection-review-notice"
          description={`${catalog.data.reviewNotice} ${user.role === "admin" ? "巡检标准目录由系统管理员维护，内容更新随新版本发布生效。" : "当前目录由系统管理员维护。"}`}
          title="审核提示"
          showIcon
          type="warning"
        />
        <Row className="inspection-standard-list" gutter={[16, 16]}>
          {catalog.data.modules.map((module) => (
            <Col key={module.code} lg={8} md={12} xs={24}>
              <Card size="small">
                <Typography.Text type="secondary">巡检模块</Typography.Text>
                <Typography.Title level={4}>{module.name}</Typography.Title>
                <Typography.Paragraph type="secondary">{module.description}</Typography.Paragraph>
                <Tag color="blue">{moduleItemCount(catalog.data.nodes, module.code)} 个巡检条目</Tag>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>
      {isAdmin ? <InspectionVersionHistoryModal open={versionsOpen} onClose={() => setVersionsOpen(false)} /> : null}
    </>
  );
  if (isMobile) {
    return (
      <MobilePage onBack={() => navigate("animal-inspection-entry")} title="巡检标准">
        {content}
      </MobilePage>
    );
  }
  return (
    <section className="workspace-view animal-management-workspace" data-feature="animal-management">
      <div className="workspace-body animal-management-body">{content}</div>
    </section>
  );
}
