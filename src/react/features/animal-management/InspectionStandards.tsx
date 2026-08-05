import { Alert, Card, Col, Descriptions, Row, Tag, Typography } from "antd";

import type { SessionUser } from "../../api/contracts";
import { useAnimalInspectionCatalog } from "../../api/animalManagement";
import { PageState } from "../../components/WorkspaceUi";
import { MobilePage } from "../../components/ui/MobilePage";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";
import type { WorkspaceView } from "../../state/ui";
import { catalogItems } from "./model";

export function InspectionStandards({
  user,
  navigate,
}: {
  user: SessionUser;
  navigate: (view: WorkspaceView) => void;
}) {
  const isMobile = useIsMobileLayout();
  const catalog = useAnimalInspectionCatalog();
  if (catalog.isLoading) return <PageState title="正在加载巡检标准..." />;
  if (catalog.isError || !catalog.data)
    return <PageState title="巡检标准加载失败" retry={() => void catalog.refetch()} />;
  const content = (
    <>
      <Card
        className="animal-ant-card inspection-standards-panel"
        extra={
          <Tag color={catalog.data.version.status === "active" ? "green" : "default"}>
            {catalog.data.version.status === "active" ? "当前生效" : catalog.data.version.status}
          </Tag>
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
          description={`${catalog.data.reviewNotice} ${user.role === "admin" ? "系统管理员可通过受控导入流程审核并发布新版本。" : "当前目录由系统管理员维护。"}`}
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
                <Tag color="blue">{catalogItems(catalog.data.nodes, module.code).length} 个巡检条目</Tag>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>
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
