import { Alert, Button, Card, Col, Divider, Form, Input, Row, Select, Space, Typography } from "antd";

import type { IntakeBatch, IntakeBatchStatus } from "../../../api/contracts";

export { IntakeBatchList } from "./IntakeBatchList";

const statuses: Array<[IntakeBatchStatus, string]> = [
  ["pending_print", "未打印"],
  ["printed", "已打印"],
  ["received", "已接收"],
  ["draft", "草稿"],
];

export function IntakeEntryPanel({
  editing,
  draft,
  roomNames,
  notice,
  saving,
  onSubmit,
  headActions,
  onParse,
  onAiParse,
  onPrint,
  onUpdate,
}: {
  editing: boolean;
  draft: IntakeBatch;
  roomNames: string[];
  notice: string;
  saving: boolean;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  headActions?: React.ReactNode;
  onParse: () => void;
  onAiParse: () => void;
  onPrint: () => void;
  onUpdate: <K extends keyof IntakeBatch>(key: K, value: IntakeBatch[K]) => void;
}) {
  return (
    <form id="intake-entry-panel" className="intake-entry-form" onSubmit={onSubmit}>
      <Card
        className="intake-entry-card"
        extra={headActions}
        title={
          <Typography.Title level={2} style={{ margin: 0 }}>
            {editing ? "编辑接收笼卡" : "接收笼卡"}
          </Typography.Title>
        }
      >
        <Row className="intake-recognition-row" gutter={[16, 16]}>
          <Col lg={18} md={16} xs={24}>
            <Card
              className="intake-recognition-card"
              extra={
                <Space>
                  <Button htmlType="button" onClick={onAiParse} size="small">
                    AI识别
                  </Button>
                  <Button htmlType="button" onClick={onParse} size="small">
                    本地识别
                  </Button>
                </Space>
              }
              size="small"
              title="预约消息识别"
              type="inner"
            >
              <Input.TextArea
                aria-label="预约消息"
                autoSize={{ minRows: 5, maxRows: 8 }}
                value={draft.rawMessage}
                onChange={(event) => onUpdate("rawMessage", event.target.value)}
                placeholder="粘贴预约接收文本，自动提取批次号、供应商、品系、数量、房间和接收日期。"
              />
            </Card>
          </Col>
          <Col lg={6} md={8} xs={24}>
            <Card className="intake-print-card" size="small" type="inner">
              <Typography.Text strong>{draft.finalCardCount || 0} 张笼卡</Typography.Text>
              <Typography.Text ellipsis type="secondary">
                {draft.batchNo || "尚未识别批次"}
              </Typography.Text>
              <Button block disabled={!draft.finalCardCount || saving} htmlType="button" onClick={onPrint}>
                打印当前笼卡
              </Button>
            </Card>
          </Col>
        </Row>
        {notice ? <Alert className="intake-notice" title={notice} showIcon type="info" /> : null}
        <Divider />
        <Form component={false} layout="vertical" requiredMark>
          <Row gutter={[16, 0]}>
            <Col lg={8} md={12} xs={24}>
              <Field
                label="购买单位"
                required
                value={draft.supplier}
                onChange={(value) => onUpdate("supplier", value)}
              />
            </Col>
            <Col lg={8} md={12} xs={24}>
              <Field label="批次号" value={draft.batchNo} onChange={(value) => onUpdate("batchNo", value)} />
            </Col>
            <Col lg={8} md={12} xs={24}>
              <Field label="IACUC 编号" required value={draft.iacuc} onChange={(value) => onUpdate("iacuc", value)} />
            </Col>
            <Col lg={12} md={12} xs={24}>
              <Field label="项目负责人" required value={draft.pi} onChange={(value) => onUpdate("pi", value)} />
            </Col>
            <Col lg={12} md={12} xs={24}>
              <Field label="实验负责人" required value={draft.owner} onChange={(value) => onUpdate("owner", value)} />
            </Col>
            <Col lg={6} md={12} xs={24}>
              <Form.Item label="物种">
                <Select
                  aria-label="物种"
                  options={[
                    ["mouse", "小鼠"],
                    ["rat", "大鼠"],
                    ["guinea_pig", "豚鼠"],
                    ["rabbit", "兔"],
                    ["monkey", "猴"],
                    ["pig", "猪"],
                    ["dog", "犬"],
                  ].map(([value, label]) => ({ value, label }))}
                  value={draft.species}
                  onChange={(value) => onUpdate("species", value)}
                />
              </Form.Item>
            </Col>
            <Col lg={6} md={12} xs={24}>
              <Field
                label="品系"
                value={draft.strainStandard}
                onChange={(value) => onUpdate("strainStandard", value)}
              />
            </Col>
            <Col lg={6} md={12} xs={24}>
              <Field
                label="数量（只）"
                type="number"
                value={draft.quantity ?? ""}
                onChange={(value) => onUpdate("quantity", value ? Number(value) : null)}
              />
            </Col>
            <Col lg={6} md={12} xs={24}>
              <Form.Item label="房间" required>
                <Select
                  aria-label="房间"
                  id="intake-room"
                  options={[
                    { value: "", label: "请选择系统房间" },
                    ...roomNames.map((room) => ({ value: room, label: room })),
                  ]}
                  value={draft.roomName}
                  onChange={(value) => onUpdate("roomName", value)}
                />
              </Form.Item>
            </Col>
            <Col lg={8} md={12} xs={24}>
              <Field
                label="接收日期"
                required
                type="date"
                value={draft.intakeDate}
                onChange={(value) => onUpdate("intakeDate", value)}
              />
            </Col>
            <Col lg={8} md={12} xs={24}>
              <Field
                label="饲养周期（天）"
                type="number"
                value={draft.husbandryDays ?? ""}
                onChange={(value) => onUpdate("husbandryDays", value ? Number(value) : null)}
              />
            </Col>
            <Col lg={8} md={12} xs={24}>
              <Field
                label="结束日期"
                type="date"
                value={draft.endDate}
                onChange={(value) => onUpdate("endDate", value)}
              />
            </Col>
            <Col lg={8} md={12} xs={24}>
              <Field label="性别" value={draft.sex} onChange={(value) => onUpdate("sex", value)} />
            </Col>
            <Col lg={8} md={12} xs={24}>
              <Field
                label="接收人员"
                value={draft.receiverName}
                onChange={(value) => onUpdate("receiverName", value)}
              />
            </Col>
            <Col lg={8} md={12} xs={24}>
              <Field label="联系电话" value={draft.vetPhone} onChange={(value) => onUpdate("vetPhone", value)} />
            </Col>
            <Col lg={12} md={12} xs={24}>
              <Field
                label="打印张数"
                type="number"
                value={draft.finalCardCount}
                onChange={(value) => onUpdate("finalCardCount", Number(value) || 0)}
              />
            </Col>
            <Col lg={12} md={12} xs={24}>
              <Form.Item label="状态">
                <Select<IntakeBatchStatus>
                  aria-label="状态"
                  value={draft.status}
                  options={statuses.map(([value, label]) => ({ value, label }))}
                  onChange={(value) => onUpdate("status", value)}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <Form.Item label={label} required={required}>
      <Input
        aria-label={label}
        type={type}
        value={value}
        min={type === "number" ? 0 : undefined}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
    </Form.Item>
  );
}
