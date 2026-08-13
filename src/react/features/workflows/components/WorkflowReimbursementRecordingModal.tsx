import { MinusCircleOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Flex, Form, Input, InputNumber, Modal, Space, Typography, Upload } from "antd";
import { useState } from "react";

import type { BillingWorkflow, BillingWorkflowAttachment } from "../../../api/workflows";
import { recordWorkflowReimbursement, uploadWorkflowAttachment } from "../../../api/workflows";

interface RecordingValues {
  reimbursementForms?: Array<{ formNo: string; amount?: number }>;
}

export function WorkflowReimbursementRecordingModal({
  target,
  onCancel,
  onRecorded,
}: {
  target: BillingWorkflow | null;
  onCancel: () => void;
  onRecorded: () => void;
}) {
  const [form] = Form.useForm<RecordingValues>();
  const [attachment, setAttachment] = useState<BillingWorkflowAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  function reset() {
    setAttachment(null);
  }

  async function submit() {
    if (!target) return;
    try {
      const values = await form.validateFields();
      const forms = (values.reimbursementForms || []).filter((entry) => entry.formNo.trim());
      if (!forms.length) {
        setFormError("请填写报销单号和金额");
        return;
      }
      setFormError("");
      setSaving(true);
      await recordWorkflowReimbursement(
        target.id,
        forms.map((entry) => ({ formNo: entry.formNo, amount: Number(entry.amount) || 0 })),
      );
      onRecorded();
    } catch (error) {
      console.error("补录报销单失败", error);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(file: File) {
    if (!target) return;
    setUploading(true);
    try {
      const uploaded = await uploadWorkflowAttachment(target.id, "reimbursement", file);
      setAttachment(uploaded ?? null);
    } finally {
      setUploading(false);
    }
    return false;
  }

  return (
    <Modal
      cancelText="取消"
      confirmLoading={saving}
      destroyOnHidden
      okText="保存补录"
      open={Boolean(target)}
      title={`补录报销单 · ${target?.month ?? ""} ${target?.pi ?? ""}`}
      width={640}
      afterClose={reset}
      onCancel={onCancel}
      onOk={() => void submit()}
    >
      {target?.reimbursementForms?.length ? (
        <Typography.Paragraph type="secondary">
          已登记报销单：{target.reimbursementForms.map((entry) => entry.formNo).join("、")}
        </Typography.Paragraph>
      ) : null}
      {formError ? <Alert showIcon style={{ marginBottom: 12 }} title={formError} type="error" /> : null}
      <Form form={form} initialValues={{ reimbursementForms: [{ formNo: "", amount: undefined }] }} layout="vertical">
        <Flex gap={8} style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ width: 220 }}>
            报销单号
          </Typography.Text>
          <Typography.Text type="secondary" style={{ width: 140 }}>
            金额（元）
          </Typography.Text>
        </Flex>
        <Form.List name="reimbursementForms">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...restField }) => (
                <Space key={key} style={{ display: "flex", marginBottom: 8 }} align="baseline">
                  <Form.Item
                    {...restField}
                    name={[name, "formNo"]}
                    rules={[{ required: true, message: "请填写报销单号" }]}
                  >
                    <Input placeholder="报销单号" style={{ width: 220 }} />
                  </Form.Item>
                  <Form.Item {...restField} name={[name, "amount"]} rules={[{ required: true, message: "请填写金额" }]}>
                    <InputNumber min={0} precision={2} placeholder="金额（元）" style={{ width: 140 }} />
                  </Form.Item>
                  <MinusCircleOutlined
                    aria-label={`删除第 ${name + 1} 行报销单`}
                    onClick={() => remove(name)}
                    role="button"
                  />
                </Space>
              ))}
              <Form.Item>
                <Button
                  block
                  icon={<PlusOutlined aria-hidden />}
                  type="dashed"
                  onClick={() => add({ formNo: "", amount: undefined })}
                >
                  添加报销单号
                </Button>
              </Form.Item>
            </>
          )}
        </Form.List>
        <Form.Item label="报销单扫描件">
          <Flex vertical gap={4}>
            <Space>
              <Upload
                accept=".pdf,.jpg,.jpeg,.png"
                maxCount={1}
                showUploadList={false}
                beforeUpload={(file) => handleUpload(file)}
              >
                <Button icon={<UploadOutlined aria-hidden />} loading={uploading} size="small">
                  上传扫描件
                </Button>
              </Upload>
              {attachment ? <Typography.Text type="secondary">{attachment.originalName}</Typography.Text> : null}
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              非必填
            </Typography.Text>
          </Flex>
        </Form.Item>
      </Form>
    </Modal>
  );
}
