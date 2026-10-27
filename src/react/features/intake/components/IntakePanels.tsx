import { ActionIcon } from "../../../components/ui/ActionIcon";
import { RobotOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Divider, Form, Input, Row, Select, Space, Typography } from "antd";
import { useRef } from "react";

import type { IntakeBatch, IntakeBatchStatus, IntakePurpose } from "../../../api/contracts";
import { isDirectSampling, normalizeIntakeSex } from "../../../../domain/intake";
import { IntakeRecognitionHelp, IntakeRecognitionImages } from "./IntakeRecognitionImages";
import type { IntakeRecognitionImageInput } from "../../../api/contracts";
import { CommandBar, DateInput } from "../../../components/ui";

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
  roomsReady = true,
  onSubmit,
  headActions,
  onParse,
  onAiParse,
  aiPending,
  onPrint,
  onUpdate,
  recognitionImages,
  recognitionError,
  onAddImages,
  onRemoveImage,
}: {
  recognitionImages: Array<IntakeRecognitionImageInput & { key: string }>;
  recognitionError: string;
  onAddImages: (files: File[]) => void;
  onRemoveImage: (key: string) => void;
  editing: boolean;
  draft: IntakeBatch;
  roomNames: string[];
  notice: string;
  saving: boolean;
  roomsReady?: boolean;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  headActions?: React.ReactNode;
  onParse: () => void;
  onAiParse: () => void;
  aiPending: boolean;
  onPrint: () => void;
  onUpdate: <K extends keyof IntakeBatch>(key: K, value: IntakeBatch[K]) => void;
}) {
  const imagePickerRef = useRef<HTMLInputElement>(null);
  const directSampling = isDirectSampling(draft);
  const purposeLocked =
    editing && (draft.status === "printed" || draft.status === "received" || draft.receipts.length > 0);
  const availableStatuses: Array<[IntakeBatchStatus, string]> = directSampling
    ? [
        ["pending_receipt", "待接收"],
        ["draft", "草稿"],
        ...(draft.status === "received" ? [["received", "已接收"] as [IntakeBatchStatus, string]] : []),
      ]
    : statuses;
  return (
    <form id="intake-entry-panel" className="intake-entry-form" onSubmit={onSubmit}>
      {headActions ? (
        <CommandBar
          title={directSampling ? "直接取材预约" : editing ? "编辑接收笼卡" : "接收笼卡"}
          titleSize="section"
          ariaLabel="编辑笼卡操作"
          sticky
          primaryAction={headActions}
        />
      ) : null}
      <Card className="intake-entry-card">
        <Row className="intake-recognition-row" gutter={[16, 16]}>
          <Col lg={18} md={16} xs={24}>
            <Card
              className="intake-recognition-card"
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files")) event.preventDefault();
              }}
              onDrop={(event) => {
                const files = Array.from(event.dataTransfer.files);
                if (files.length) {
                  event.preventDefault();
                  onAddImages(files);
                }
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files);
                if (files.length) {
                  event.preventDefault();
                  onAddImages(files);
                }
              }}
              extra={
                <Space wrap className="intake-recognition-actions" role="group" aria-label="预约识别操作">
                  <Button
                    htmlType="button"
                    icon={<ActionIcon name="upload" />}
                    onClick={() => imagePickerRef.current?.click()}
                    size="small"
                  >
                    选择预约图片
                  </Button>
                  <Button
                    icon={<ActionIcon name="scan" />}
                    htmlType="button"
                    disabled={!roomsReady || !draft.rawMessage.trim()}
                    onClick={onParse}
                    size="small"
                  >
                    本地识别
                  </Button>
                  <Button
                    htmlType="button"
                    icon={<RobotOutlined aria-hidden />}
                    disabled={!roomsReady || (!draft.rawMessage.trim() && !recognitionImages.length)}
                    loading={aiPending}
                    onClick={onAiParse}
                    size="small"
                    type="primary"
                  >
                    AI识别
                  </Button>
                </Space>
              }
              size="small"
              title={
                <Space size={8}>
                  <span>预约消息识别</span>
                  <IntakeRecognitionHelp />
                </Space>
              }
              type="inner"
            >
              <div>
                <Input.TextArea
                  aria-label="预约消息"
                  autoSize={{ minRows: 5, maxRows: 8 }}
                  value={draft.rawMessage}
                  onChange={(event) => onUpdate("rawMessage", event.target.value)}
                  placeholder="粘贴预约接收文本，自动提取批次号、供应商、品系、数量、房间和接收日期。"
                />
                <IntakeRecognitionImages
                  images={recognitionImages}
                  error={recognitionError}
                  evidence={draft.recognition}
                  onAdd={onAddImages}
                  onRemove={onRemoveImage}
                  pickerRef={imagePickerRef}
                />
              </div>
            </Card>
          </Col>
          <Col lg={6} md={8} xs={24}>
            <Card className="intake-print-card" size="small" type="inner">
              <Typography.Text strong>
                {directSampling ? "直接取材" : `${draft.finalCardCount || 0} 张笼卡`}
              </Typography.Text>
              <Typography.Text ellipsis type="secondary">
                {draft.batchNo || "尚未识别批次"}
              </Typography.Text>
              {directSampling ? (
                <Typography.Text type="secondary">无需打印笼卡，到货后可直接确认接收。</Typography.Text>
              ) : (
                <Button
                  icon={<ActionIcon name="print" />}
                  block
                  disabled={!draft.finalCardCount || saving || !roomsReady}
                  htmlType="button"
                  onClick={onPrint}
                >
                  打印当前笼卡
                </Button>
              )}
            </Card>
          </Col>
        </Row>
        {notice ? <Alert className="intake-notice" title={notice} showIcon type="info" /> : null}
        <Divider />
        <Form component={false} layout="vertical" requiredMark>
          <Row gutter={[16, 16]}>
            <Col md={directSampling ? 24 : 12} xs={24}>
              <Form.Item label="接收用途" required>
                <Select<IntakePurpose>
                  aria-label="接收用途"
                  value={draft.intakePurpose || "housing"}
                  disabled={purposeLocked}
                  options={[
                    { value: "housing", label: "入驻饲养" },
                    { value: "direct_sampling", label: "直接取材" },
                  ]}
                  onChange={(value) => onUpdate("intakePurpose", value)}
                />
              </Form.Item>
            </Col>
            {!directSampling && (
              <Col md={12} xs={24}>
                <Form.Item label="房间" required>
                  <Select
                    aria-label="房间"
                    id="intake-room"
                    disabled={!roomsReady}
                    options={[
                      { value: "", label: "请选择系统房间" },
                      ...roomNames.map((room) => ({ value: room, label: room })),
                    ]}
                    value={draft.roomName}
                    onChange={(value) => onUpdate("roomName", value)}
                  />
                </Form.Item>
              </Col>
            )}
          </Row>
          <Row gutter={[16, 16]}>
            <Col lg={8} md={12} xs={24}>
              <Field
                label="购买单位"
                required
                value={draft.supplier}
                onChange={(value) => onUpdate("supplier", value)}
              />
            </Col>
            <Col lg={8} md={12} xs={24}>
              <Field
                label="采购单号"
                value={draft.purchaseOrderNo}
                onChange={(value) => onUpdate("purchaseOrderNo", value)}
              />
            </Col>
            <Col lg={8} md={12} xs={24}>
              <Field label="批次号" value={draft.batchNo} onChange={(value) => onUpdate("batchNo", value)} />
            </Col>
          </Row>
          <Row gutter={[16, 16]}>
            <Col lg={4} md={12} xs={24}>
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
            <Col lg={5} md={12} xs={24}>
              <Field
                label="品系"
                value={draft.strainStandard}
                onChange={(value) => onUpdate("strainStandard", value)}
              />
            </Col>
            <Col lg={5} md={12} xs={24}>
              <Field
                label="体重/日龄（规格）"
                value={draft.specification ?? ""}
                onChange={(value) => onUpdate("specification", value)}
              />
            </Col>
            <Col lg={5} md={12} xs={24}>
              <Form.Item label="性别">
                <Select
                  aria-label="性别"
                  options={["雌性", "雄性", "雌性/雄性"].map((value) => ({ value, label: value }))}
                  value={normalizeIntakeSex(draft.sex)}
                  onChange={(value) => onUpdate("sex", value)}
                />
              </Form.Item>
            </Col>
            <Col lg={5} md={12} xs={24}>
              <Field
                label="数量（只）"
                required={directSampling}
                type="number"
                value={draft.quantity ?? ""}
                onChange={(value) => onUpdate("quantity", value ? Number(value) : null)}
              />
            </Col>
          </Row>
          <Row gutter={[16, 16]}>
            <Col lg={8} md={12} xs={24}>
              <Field label="IACUC 编号" required value={draft.iacuc} onChange={(value) => onUpdate("iacuc", value)} />
            </Col>
            <Col lg={8} md={12} xs={24}>
              <Field label="项目负责人" required value={draft.pi} onChange={(value) => onUpdate("pi", value)} />
            </Col>
            <Col lg={8} md={12} xs={24}>
              <Field label="实验负责人" required value={draft.owner} onChange={(value) => onUpdate("owner", value)} />
            </Col>
          </Row>
          <Row gutter={[16, 16]}>
            <Col lg={directSampling ? 24 : 8} md={directSampling ? 24 : 12} xs={24}>
              <Field
                label="接收日期"
                required
                type="date"
                value={draft.intakeDate}
                onChange={(value) => onUpdate("intakeDate", value)}
              />
            </Col>
            {!directSampling && (
              <>
                <Col lg={8} md={12} xs={24}>
                  <Field
                    label="结束日期"
                    type="date"
                    value={draft.endDate}
                    onChange={(value) => onUpdate("endDate", value)}
                  />
                </Col>
                <Col lg={8} md={12} xs={24}>
                  <Field
                    label="饲养周期（天）"
                    type="number"
                    value={draft.husbandryDays ?? ""}
                    extra={
                      draft.husbandryMonths
                        ? `按 ${draft.husbandryMonths} 个自然月计算${draft.intakeDate ? "" : "，请先填写接收日期"}`
                        : undefined
                    }
                    onChange={(value) => onUpdate("husbandryDays", value ? Number(value) : null)}
                  />
                </Col>
              </>
            )}
          </Row>
          <Row gutter={[16, 16]}>
            <Col lg={directSampling ? 8 : 6} md={12} xs={24}>
              <Field
                label="接收人员"
                value={draft.receiverName}
                onChange={(value) => onUpdate("receiverName", value)}
              />
            </Col>
            <Col lg={directSampling ? 8 : 6} md={12} xs={24}>
              <Field label="联系电话" value={draft.vetPhone} onChange={(value) => onUpdate("vetPhone", value)} />
            </Col>
            {!directSampling && (
              <Col lg={6} md={12} xs={24}>
                <Field
                  label="打印张数"
                  type="number"
                  value={draft.finalCardCount}
                  onChange={(value) => onUpdate("finalCardCount", Number(value) || 0)}
                />
              </Col>
            )}
            <Col lg={directSampling ? 8 : 6} md={12} xs={24}>
              <Form.Item label="状态">
                <Select<IntakeBatchStatus>
                  aria-label="状态"
                  value={draft.status}
                  disabled={directSampling && draft.status === "received"}
                  options={availableStatuses.map(([value, label]) => ({ value, label }))}
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
  extra,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  extra?: string;
}) {
  return (
    <Form.Item label={label} required={required} extra={extra}>
      {type === "date" ? (
        <DateInput label={label} value={String(value)} onChange={onChange} required={required} />
      ) : (
        <Input
          aria-label={label}
          type={type}
          value={value}
          min={type === "number" ? 0 : undefined}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Form.Item>
  );
}
