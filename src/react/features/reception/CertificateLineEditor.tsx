import { Button, Card, Collapse, Form, Input, InputNumber, Popconfirm, Select, Space, Tag, Typography } from "antd";
import { cloneElement, type ReactElement } from "react";

import type { ReceptionCertificateLine } from "../../../contracts/reception";
import { ActionIcon } from "../../components/ui";
import { certificateSexOptions } from "./certificateDraft";
import type { CertificateSharedPatch } from "./certificateGroups";

type Entry = {
  line: ReceptionCertificateLine;
  index: number;
  errors: Partial<Record<keyof ReceptionCertificateLine, string>>;
};

export function CertificateLineEditor({
  entries,
  groupIndex,
  attachments,
  receipts,
  readOnly,
  onSharedChange,
  onLineChange,
  onAddSex,
  onRemove,
  onRemoveGroup,
}: {
  entries: Entry[];
  groupIndex: number;
  attachments: Array<{ value: string; label: string }>;
  receipts: Array<{ id: string; actualReceiptDate: string }>;
  readOnly: boolean;
  onSharedChange: (patch: CertificateSharedPatch) => void;
  onLineChange: (line: ReceptionCertificateLine) => void;
  onAddSex: () => void;
  onRemove: (id: string) => void;
  onRemoveGroup: () => void;
}) {
  const first = entries[0];
  const line = first.line;
  const quantityKnown = entries.every(
    ({ line: item }) => item.quantity != null && item.quantity > 0 && Number.isInteger(item.quantity),
  );
  const total = quantityKnown ? entries.reduce((sum, { line: item }) => sum + (item.quantity ?? 0), 0) : null;

  function field(
    entry: Entry,
    key: keyof ReceptionCertificateLine,
    label: string,
    control: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>,
    required = false,
  ) {
    const id = `reception-certificate-${entry.line.id}-${key}`;
    const error = entry.errors[key];
    return (
      <Form.Item
        key={`${entry.line.id}-${key}`}
        label={label}
        htmlFor={id}
        required={required}
        validateStatus={error ? "error" : undefined}
        help={error ? <span id={`${id}-error`}>{error}</span> : undefined}
      >
        {cloneElement(control, {
          id,
          "aria-invalid": Boolean(error),
          "aria-describedby": error ? `${id}-error` : undefined,
        })}
      </Form.Item>
    );
  }

  function text(
    key:
      | "certificateNo"
      | "certificateStrain"
      | "grade"
      | "supplier"
      | "weightRaw"
      | "ageRaw"
      | "specification"
      | "experimentCertificateNo"
      | "notes",
    label: string,
    required = false,
  ) {
    return field(
      first,
      key,
      label,
      <Input
        aria-label={`明细${first.index + 1} ${label}`}
        value={line[key]}
        readOnly={readOnly}
        onChange={(event) => onSharedChange({ [key]: event.target.value })}
      />,
      required,
    );
  }

  return (
    <Card
      size="small"
      title={
        <Space wrap>
          合格证 {groupIndex + 1}
          <Tag>{entries.every(({ line: item }) => item.runId) ? "AI识别来源" : "含人工录入"}</Tag>
        </Space>
      }
      extra={
        !readOnly ? (
          <Popconfirm
            title="删除这张合格证的登记明细？"
            description="将从当前编辑内容移除这张卡片下的全部明细，原件保留，保存后生效。"
            placement="topRight"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={onRemoveGroup}
          >
            <Button danger size="small" aria-label={`删除合格证${groupIndex + 1}`}>
              删除合格证
            </Button>
          </Popconfirm>
        ) : undefined
      }
    >
      <div className="reception-certificate-fields">
        {text("certificateNo", "合格证编号", true)}
        {text("certificateStrain", "证载品系", true)}
        {text("grade", "等级", true)}
        {text("supplier", "供应商", true)}
      </div>
      {entries.map((entry) => (
        <div key={entry.line.id}>
          <div className="reception-certificate-sex-row">
            {field(
              entry,
              "sex",
              "证载性别",
              <Select
                aria-label={`明细${entry.index + 1} 证载性别`}
                value={entry.line.sex || undefined}
                options={certificateSexOptions.map((value) => ({ value, label: value }))}
                onChange={(value) => onLineChange({ ...entry.line, sex: value })}
              />,
              true,
            )}
            {field(
              entry,
              "quantity",
              "证载数量",
              <InputNumber
                aria-label={`明细${entry.index + 1} 证载数量`}
                min={0}
                step={1}
                value={entry.line.quantity}
                placeholder="未知，待核对"
                onChange={(value) => onLineChange({ ...entry.line, quantity: value })}
              />,
              true,
            )}
            {!readOnly ? (
              <div className="reception-certificate-sex-action">
                <Button
                  danger
                  size="small"
                  onClick={() => onRemove(entry.line.id)}
                  aria-label={`删除明细${entry.index + 1}`}
                >
                  移除
                </Button>
              </div>
            ) : null}
          </div>
          {receipts.length > 1
            ? field(
                entry,
                "receiptId",
                "关联实际接收记录",
                <Select
                  aria-label={`明细${entry.index + 1} 关联实际接收记录`}
                  value={entry.line.receiptId ?? undefined}
                  allowClear
                  placeholder="选择接收日期"
                  options={receipts.map((receipt) => ({ value: receipt.id, label: receipt.actualReceiptDate }))}
                  onChange={(value: string | undefined) => onLineChange({ ...entry.line, receiptId: value ?? null })}
                />,
              )
            : null}
        </div>
      ))}
      <Space wrap className="reception-certificate-sex-summary">
        {!readOnly ? (
          <Button size="small" icon={<ActionIcon name="create" />} onClick={onAddSex}>
            补充性别和数量
          </Button>
        ) : null}
        <Typography.Text type="secondary">{total == null ? "合计待确认" : `合计 ${total} 只`}</Typography.Text>
      </Space>
      <div className="reception-certificate-fields">
        {text("specification", "登记规格")}
        {text("notes", "登记备注")}
      </div>
      <Collapse
        size="small"
        items={[
          {
            key: "source",
            label: "高级信息：来源原件与证件序号",
            forceRender: true,
            children: (
              <>
                <div className="reception-certificate-fields">
                  {text("weightRaw", "证载体重原文")}
                  {text("ageRaw", "证载日龄原文")}
                  {text("experimentCertificateNo", "动物实验证明编号")}
                  {field(
                    first,
                    "attachmentId",
                    "来源原件",
                    <Select
                      aria-label={`明细${first.index + 1} 来源原件`}
                      value={line.attachmentId || undefined}
                      options={attachments}
                      onChange={(value) => onSharedChange({ attachmentId: value })}
                    />,
                    true,
                  )}
                  {field(
                    first,
                    "certificateIndex",
                    "证件序号",
                    <InputNumber
                      aria-label={`明细${first.index + 1} 证件序号`}
                      min={1}
                      precision={0}
                      value={line.certificateIndex}
                      onChange={(value) => onSharedChange({ certificateIndex: value ?? 0 })}
                    />,
                    true,
                  )}
                </div>
                {entries.map((entry) =>
                  field(
                    entry,
                    "certificateLineIndex",
                    `明细${entry.index + 1} 证内行号`,
                    <InputNumber
                      aria-label={`明细${entry.index + 1} 证内行号`}
                      min={1}
                      precision={0}
                      value={entry.line.certificateLineIndex}
                      onChange={(value) => onLineChange({ ...entry.line, certificateLineIndex: value ?? 0 })}
                    />,
                    true,
                  ),
                )}
              </>
            ),
          },
        ]}
      />
    </Card>
  );
}
