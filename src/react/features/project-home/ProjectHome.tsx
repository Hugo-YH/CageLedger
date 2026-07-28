import {
  AppstoreOutlined,
  AuditOutlined,
  BookOutlined,
  CalculatorOutlined,
  CheckCircleFilled,
  CodeOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FileTextOutlined,
  GithubOutlined,
  RightOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import { Anchor, Button, Card, Col, Divider, Layout, Row, Space, Steps, Tag, Typography } from "antd";
import type { ReactNode } from "react";

import { PROJECT_METADATA, PROJECT_RESOURCE_LINKS } from "./projectMetadata";

const capabilityItems: Array<{ icon: ReactNode; title: string; detail: string }> = [
  {
    icon: <TagsOutlined />,
    title: "笼卡接收",
    detail: "录入预约信息、生成笼卡、接收批次，并通过二维码查询当前状态。",
  },
  {
    icon: <AppstoreOutlined />,
    title: "笼位管理",
    detail: "按设施、房间和笼架管理笼位占用、预留、入驻与历史记录。",
  },
  {
    icon: <AuditOutlined />,
    title: "动物管理",
    detail: "围绕饲养间开展动物巡检、异常处置、复查与记录归档。",
  },
  {
    icon: <CalculatorOutlined />,
    title: "饲养费结算",
    detail: "支持数量统计、项目负责人合表、月度汇总与服务端 PDF 导出。",
  },
  {
    icon: <DatabaseOutlined />,
    title: "报销核销",
    detail: "将结算应收、报销单、经费明细与核销分摊保留在完整审计链路中。",
  },
  {
    icon: <DeploymentUnitOutlined />,
    title: "私有化部署",
    detail: "提供 Docker、群晖 NAS 与离线包部署路径，数据保留在本地运行环境。",
  },
];

const workflowItems = [
  { title: "接收录入", content: <span className="project-workflow-step-detail">识别预约信息，创建批次与笼卡。</span> },
  {
    title: "笼位与动物管理",
    content: <span className="project-workflow-step-detail">维护占用、巡检与异常处置。</span>,
  },
  { title: "数量统计", content: <span className="project-workflow-step-detail">按月记录数量与计费条件。</span> },
  {
    title: "项目负责人结算",
    content: <span className="project-workflow-step-detail">合并 IACUC 明细并生成核算汇总。</span>,
  },
  {
    title: "报销核销",
    content: <span className="project-workflow-step-detail">关联报销单、经费明细与应收分摊。</span>,
  },
];

const anchorItems = [
  { key: "capabilities", href: "#capabilities", title: "能力" },
  { key: "workflow", href: "#workflow", title: "流程" },
  { key: "resources", href: "#resources", title: "资源" },
];

export function ProjectHome() {
  return (
    <Layout className="project-home">
      <header className="project-home-header">
        <a className="project-home-brand" href="#overview">
          <img alt="" src="/cageledger-icon.svg" />
          <span>{PROJECT_METADATA.name}</span>
        </a>
        <nav aria-label="项目门户导航" className="project-home-nav">
          <Anchor affix={false} direction="horizontal" items={anchorItems} />
        </nav>
        <Space className="project-home-header-actions" size={8} wrap>
          <Button href={PROJECT_METADATA.repositoryUrl} icon={<GithubOutlined />} target="_blank">
            Gitea
          </Button>
          <Button href="/app" type="primary">
            进入系统
          </Button>
        </Space>
      </header>

      <main>
        <section className="project-hero project-section" id="overview">
          <div className="project-hero-copy">
            <Tag color="blue">实验动物中心运营平台</Tag>
            <Typography.Title level={1}>{PROJECT_METADATA.productName}</Typography.Title>
            <Typography.Paragraph>{PROJECT_METADATA.summary}</Typography.Paragraph>
            <Space className="project-hero-actions" size={12} wrap>
              <Button href="/app" size="large" type="primary">
                进入系统 <RightOutlined />
              </Button>
              <Button href={PROJECT_METADATA.docsUrl} size="large">
                查看文档
              </Button>
            </Space>
          </div>
          <Card className="project-hero-panel" variant="borderless">
            <ProductScene />
          </Card>
        </section>

        <section className="project-section" id="capabilities">
          <SectionHeading
            eyebrow="核心能力"
            title="围绕实验动物中心日常工作的统一系统"
            detail="业务数据保留在受控运行环境中，工作流、账务和审计记录使用同一套业务链路。"
          />
          <Row className="project-capability-grid" gutter={[16, 16]}>
            {capabilityItems.map((item) => (
              <Col key={item.title} lg={8} md={12} sm={24} xs={24}>
                <Card className="project-capability-card" size="small">
                  <span className="project-capability-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <Typography.Title level={4}>{item.title}</Typography.Title>
                  <Typography.Paragraph>{item.detail}</Typography.Paragraph>
                </Card>
              </Col>
            ))}
          </Row>
        </section>

        <section className="project-section project-workflow-section" id="workflow">
          <SectionHeading
            eyebrow="工作流程"
            title="一条完整、可追溯的运营闭环"
            detail="各环节保留原始业务信息、状态变化与审计记录，支持日常管理和月度财务协作。"
          />
          <Card className="project-workflow-card">
            <Steps current={-1} items={workflowItems} responsive />
          </Card>
        </section>

        <section className="project-section" id="resources">
          <SectionHeading
            eyebrow="项目资源"
            title="文档、版本与部署资源"
            detail="项目文档随系统同域提供；Gitea 承载源码、正式 Release、离线包与容器镜像分发。"
          />
          <Row className="project-resource-grid" gutter={[16, 16]}>
            {PROJECT_RESOURCE_LINKS.map((item, index) => (
              <Col key={item.title} md={8} sm={24} xs={24}>
                <Card className="project-resource-card" hoverable>
                  {index === 0 ? <BookOutlined /> : index === 1 ? <FileTextOutlined /> : <CodeOutlined />}
                  <Typography.Title level={4}>{item.title}</Typography.Title>
                  <Typography.Paragraph>{item.description}</Typography.Paragraph>
                  <Button href={item.href} target="_blank" type="link">
                    打开资源 <RightOutlined />
                  </Button>
                </Card>
              </Col>
            ))}
          </Row>
        </section>
      </main>

      <footer className="project-home-footer">
        <Divider />
        <div>
          <span>
            {PROJECT_METADATA.name} v{PROJECT_METADATA.version}
          </span>
          <span>{PROJECT_METADATA.organization}</span>
        </div>
        <Space size={16} wrap>
          <a href={PROJECT_METADATA.repositoryUrl} target="_blank" rel="noreferrer">
            Gitea
          </a>
          <a href={PROJECT_METADATA.docsUrl}>文档</a>
          <a href={PROJECT_METADATA.releasesUrl} target="_blank" rel="noreferrer">
            Release
          </a>
        </Space>
      </footer>
    </Layout>
  );
}

function SectionHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return (
    <div className="project-section-heading">
      <span>{eyebrow}</span>
      <Typography.Title level={2}>{title}</Typography.Title>
      <Typography.Paragraph>{detail}</Typography.Paragraph>
    </div>
  );
}

function ProductScene() {
  return (
    <div aria-label="CageLedger 运营闭环示意" className="project-demo" role="img">
      <div className="project-demo-head">
        <div>
          <span className="project-eyebrow">运营闭环示意</span>
          <strong>接收、饲养到结算核销</strong>
        </div>
        <Tag color="success" icon={<CheckCircleFilled />} variant="filled">
          本地受控
        </Tag>
      </div>

      <div className="project-demo-content">
        <div className="project-demo-cages" aria-label="笼位状态示意">
          <span className="project-demo-cage is-active">A1</span>
          <span className="project-demo-cage">A2</span>
          <span className="project-demo-cage is-reserved">A3</span>
          <span className="project-demo-cage">B1</span>
          <span className="project-demo-cage is-active">B2</span>
          <span className="project-demo-cage">B3</span>
          <span className="project-demo-cage is-empty">C1</span>
          <span className="project-demo-cage">C2</span>
          <span className="project-demo-cage is-reserved">C3</span>
        </div>

        <div className="project-demo-flow" aria-label="业务流转示意">
          <div className="project-demo-flow-line" aria-hidden="true">
            <span />
          </div>
          <div className="project-demo-flow-item">
            <span>01</span>
            <div>
              <strong>笼卡接收</strong>
              <small>IACUC 关联</small>
            </div>
          </div>
          <div className="project-demo-flow-item">
            <span>02</span>
            <div>
              <strong>数量统计</strong>
              <small>日常台账</small>
            </div>
          </div>
          <div className="project-demo-flow-item">
            <span>03</span>
            <div>
              <strong>结算核销</strong>
              <small>审计归档</small>
            </div>
          </div>
        </div>
      </div>

      <div className="project-demo-ledger">
        <span>统一业务键</span>
        <div>
          <Tag>IACUC</Tag>
          <Tag>数量统计</Tag>
          <Tag>结算单</Tag>
          <Tag>报销台账</Tag>
        </div>
      </div>
    </div>
  );
}
