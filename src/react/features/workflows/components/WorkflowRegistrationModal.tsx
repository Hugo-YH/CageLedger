import { MinusCircleOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import {
  Alert,
  AutoComplete,
  Button,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Switch,
  Tag,
  Typography,
  Upload,
} from "antd";
import { useMemo, useState } from "react";

import { buildFundingBookOptions } from "../../../../domain/fundingBookNo";
import type { BillingWorkflow, BillingWorkflowAttachment } from "../../../api/workflows";
import { uploadWorkflowAttachment, useAdvanceWorkflow } from "../../../api/workflows";

interface RegistrationValues {
  reimbursementForms?: Array<{ formNo: string; amount?: number; fundingBookNo?: string }>;
  signedStatementReturned?: boolean;
  signedStatementNote?: string;
  reimbursementFormReturned?: boolean;
  reimbursementFormNote?: string;
}

function registrationInitialValues(target: BillingWorkflow): RegistrationValues {
  const previousForms = (target.reimbursementForms || []).filter((entry) => entry.formNo);
  return {
    signedStatementReturned: Boolean(target.signedStatementReturned),
    signedStatementNote: target.signedStatementNote || "",
    reimbursementFormReturned: Boolean(target.reimbursementFormReturned),
    reimbursementForms: previousForms.length
      ? previousForms.map((entry) => ({
          fundingBookNo: entry.fundingBookNo || "",
          formNo: entry.formNo,
          amount: entry.amount,
        }))
      : [{ formNo: "", amount: Number(target.totalAmount || 0) || undefined, fundingBookNo: "" }],
    reimbursementFormNote: target.reimbursementFormNote || "",
  };
}

function RegistrationSwitch({
  checked,
  label,
  onChange,
  returnedLabel,
  unreturnedLabel,
}: {
  checked?: boolean;
  label: string;
  onChange?: (checked: boolean) => void;
  returnedLabel: string;
  unreturnedLabel: string;
}) {
  return (
    <Space size={8}>
      <Switch aria-label={label} checked={checked} onChange={onChange} />
      <span>{label}</span>
      <Tag color={checked ? "success" : "default"}>{checked ? returnedLabel : unreturnedLabel}</Tag>
    </Space>
  );
}

export function WorkflowRegistrationModal({
  target,
  onCancel,
  onRegistered,
}: {
  target: BillingWorkflow | null;
  onCancel: () => void;
  onRegistered: () => void;
}) {
  return (
    <Modal
      destroyOnHidden
      footer={null}
      open={Boolean(target)}
      title={`交回登记 · ${target?.month ?? ""} ${target?.pi ?? ""}`}
      width={640}
      onCancel={onCancel}
    >
      {target ? <WorkflowRegistrationForm target={target} onCancel={onCancel} onRegistered={onRegistered} /> : null}
    </Modal>
  );
}

function WorkflowRegistrationForm({
  target,
  onCancel,
  onRegistered,
}: {
  target: BillingWorkflow;
  onCancel: () => void;
  onRegistered: () => void;
}) {
  const advance = useAdvanceWorkflow();
  const [form] = Form.useForm<RegistrationValues>();
  const signedStatementReturned = Form.useWatch("signedStatementReturned", form);
  const reimbursementFormReturned = Form.useWatch("reimbursementFormReturned", form);
  const reimbursementForms = Form.useWatch("reimbursementForms", form);
  const [settlementAttachment, setSettlementAttachment] = useState<BillingWorkflowAttachment | null>(null);
  const [reimbursementAttachment, setReimbursementAttachment] = useState<BillingWorkflowAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const hasPayableAmount = Number(target.totalAmount || 0) > 0;
  const fundingOptions = useMemo(() => buildFundingBookOptions(target.funding || ""), [target.funding]);

  async function submitRegistration() {
    const values = await form.validateFields();
    const reimbursementForms = (values.reimbursementForms || []).filter((entry) => entry.formNo.trim());
    if (values.reimbursementFormReturned && !reimbursementForms.length) return;
    await advance.mutateAsync({
      workflowId: target.id,
      toStatus: "statement_archived",
      registration: {
        reimbursementForms: reimbursementForms.map((entry) => ({
          formNo: entry.formNo,
          amount: Number(entry.amount) || 0,
          fundingBookNo: entry.fundingBookNo?.trim() || "",
        })),
        signedStatementReturned: Boolean(values.signedStatementReturned),
        signedStatementNote: values.signedStatementNote?.trim() || "",
        reimbursementFormReturned: Boolean(values.reimbursementFormReturned),
        reimbursementFormNote: values.reimbursementFormNote?.trim() || "",
      },
    });
    onRegistered();
  }

  async function handleUpload(kind: "settlement" | "reimbursement", file: File) {
    setUploading(true);
    try {
      const attachment = await uploadWorkflowAttachment(target.id, kind, file);
      if (kind === "settlement") setSettlementAttachment(attachment ?? null);
      else setReimbursementAttachment(attachment ?? null);
    } finally {
      setUploading(false);
    }
    return false;
  }

  const attachmentField = (
    label: string,
    attachment: BillingWorkflowAttachment | null,
    kind: "settlement" | "reimbursement",
  ) => (
    <Flex vertical gap={4}>
      <Space>
        <Upload
          accept=".pdf,.jpg,.jpeg,.png"
          maxCount={1}
          showUploadList={false}
          beforeUpload={(file) => handleUpload(kind, file)}
        >
          <Button icon={<UploadOutlined aria-hidden />} loading={uploading} size="small">
            上传扫描件
          </Button>
        </Upload>
        {attachment ? <Typography.Text type="secondary">{attachment.originalName}</Typography.Text> : null}
      </Space>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Typography.Text>
    </Flex>
  );

  return (
    <Form
      form={form}
      initialValues={registrationInitialValues(target)}
      layout="vertical"
      onFinish={() => void submitRegistration()}
    >
      <Form.Item
        name="signedStatementReturned"
        rules={[
          {
            validator: (_, value) =>
              value ? Promise.resolve() : Promise.reject(new Error("请确认已交回饲养费结算单")),
          },
        ]}
        valuePropName="checked"
      >
        <RegistrationSwitch label="饲养费结算单" returnedLabel="已交回" unreturnedLabel="未交回" />
      </Form.Item>
      {signedStatementReturned ? (
        <>
          <Form.Item label="饲养费结算单扫描件">
            {attachmentField("非必填", settlementAttachment, "settlement")}
          </Form.Item>
          <Form.Item label="饲养费结算单备注" name="signedStatementNote">
            <Input.TextArea maxLength={500} placeholder="选填，记录交回相关信息" rows={2} />
          </Form.Item>
        </>
      ) : null}
      {hasPayableAmount ? (
        <>
          <Form.Item name="reimbursementFormReturned" valuePropName="checked">
            <RegistrationSwitch label="报销单" returnedLabel="已交回" unreturnedLabel="未交回" />
          </Form.Item>
          {reimbursementFormReturned ? (
            <>
              <Flex gap={8} style={{ marginBottom: 8 }}>
                <Typography.Text type="secondary" style={{ width: 200 }}>
                  经费本编号
                </Typography.Text>
                <Typography.Text type="secondary" style={{ width: 200 }}>
                  报销单号
                </Typography.Text>
                <Typography.Text type="secondary" style={{ width: 120 }}>
                  金额（元）
                </Typography.Text>
              </Flex>
              <Form.List name="reimbursementForms">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name, ...restField }) => (
                      <Space key={key} style={{ display: "flex", marginBottom: 8 }} align="baseline">
                        <Form.Item {...restField} name={[name, "fundingBookNo"]}>
                          <AutoComplete
                            allowClear
                            options={fundingOptions}
                            placeholder="选择或输入经费本编号"
                            style={{ width: 200 }}
                          />
                        </Form.Item>
                        <Form.Item
                          {...restField}
                          name={[name, "formNo"]}
                          rules={[{ required: true, message: "请填写报销单号" }]}
                        >
                          <Input placeholder="报销单号" style={{ width: 200 }} />
                        </Form.Item>
                        <Form.Item
                          {...restField}
                          name={[name, "amount"]}
                          rules={[{ required: true, message: "请填写金额" }]}
                        >
                          <InputNumber
                            controls={false}
                            min={0}
                            precision={2}
                            placeholder="金额（元）"
                            style={{ width: 120 }}
                          />
                        </Form.Item>
                        <MinusCircleOutlined
                          aria-label={`删除第 ${name + 1} 行报销单`}
                          onClick={() => remove(name)}
                          role="button"
                        />
                      </Space>
                    ))}
                    {reimbursementFormReturned && !(reimbursementForms || []).length ? (
                      <Alert showIcon style={{ marginBottom: 8 }} title="请填写报销单号和金额" type="error" />
                    ) : null}
                    <Form.Item>
                      <Button
                        block
                        icon={<PlusOutlined aria-hidden />}
                        type="dashed"
                        onClick={() => add({ formNo: "", amount: undefined, fundingBookNo: "" })}
                      >
                        添加报销单号
                      </Button>
                    </Form.Item>
                  </>
                )}
              </Form.List>
              <Form.Item label="报销单扫描件" style={{ marginTop: 12 }}>
                {attachmentField("非必填", reimbursementAttachment, "reimbursement")}
              </Form.Item>
              <Form.Item label="报销单备注" name="reimbursementFormNote">
                <Input.TextArea maxLength={500} placeholder="选填，记录交回相关信息" rows={2} />
              </Form.Item>
            </>
          ) : null}
        </>
      ) : null}
      <Flex justify="flex-end" gap={8} style={{ marginTop: 16 }}>
        <Button onClick={onCancel}>取消</Button>
        <Button loading={advance.isPending} type="primary" onClick={() => void form.submit()}>
          登记并归档
        </Button>
      </Flex>
    </Form>
  );
}
