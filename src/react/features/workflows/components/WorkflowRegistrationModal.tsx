import { UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Flex, Form, Input, Modal, Space, Switch, Tag, Typography, Upload } from "antd";
import { useState } from "react";

import { fundingBookRemark, reviewFundingBookNos, type FundingBookReference } from "../../../../domain/fundingBookNo";
import { defaultReimbursementFormNo } from "../../../../domain/reimbursementFormNo";
import type { BillingWorkflow, BillingWorkflowAttachment } from "../../../api/workflows";
import { uploadWorkflowAttachment, useAdvanceWorkflow, useWorkflowFundingBookOptions } from "../../../api/workflows";
import { FundingBookConfirmationModal } from "./FundingBookConfirmationModal";
import { useAsyncFormAction } from "../../../hooks/useAsyncFormAction";
import { ReimbursementFormFields } from "./ReimbursementFormFields";

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
      : [
          {
            formNo: defaultReimbursementFormNo(),
            amount: Number(target.totalAmount || 0) || undefined,
            fundingBookNo: "",
          },
        ],
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
      rootClassName="app-modal-root workflow-registration-modal"
      title={`交回登记 · ${target?.month ?? ""} ${target?.pi ?? ""}`}
      width={640}
      onCancel={onCancel}
    >
      {target ? (
        <WorkflowRegistrationForm key={target.id} target={target} onCancel={onCancel} onRegistered={onRegistered} />
      ) : null}
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
  const save = useAsyncFormAction("交回登记失败，请重试");
  const upload = useAsyncFormAction("扫描件上传失败，请重试");
  const [fundingBookReview, setFundingBookReview] = useState<{
    otherProjectOptions: FundingBookReference[];
    unknownFundingBookNos: string[];
  }>({ otherProjectOptions: [], unknownFundingBookNos: [] });
  const hasPayableAmount = Number(target.totalAmount || 0) > 0;
  const fundingBookOptions = useWorkflowFundingBookOptions(target.id);
  const fundingOptions = fundingBookOptions.data?.items ?? [];

  async function submitRegistration(confirmed = false) {
    if (upload.pending) return;
    await save.run(
      async () => {
        const values = await form.validateFields();
        const reimbursementForms = (values.reimbursementForms || []).filter((entry) => entry.formNo.trim());
        if (values.reimbursementFormReturned && !reimbursementForms.length) return;
        const review = fundingBookOptions.data
          ? reviewFundingBookNos(
              reimbursementForms.map((entry) => entry.fundingBookNo),
              fundingBookOptions.data.items.map((option) => option.value),
              fundingBookOptions.data.piFundingBookOptions,
            )
          : { otherProjectOptions: [], unknownFundingBookNos: [] };
        if (!confirmed && (review.otherProjectOptions.length || review.unknownFundingBookNos.length)) {
          setFundingBookReview(review);
          return;
        }
        setFundingBookReview({ otherProjectOptions: [], unknownFundingBookNos: [] });
        const automaticRemarks = review.otherProjectOptions.map(fundingBookRemark);
        const reimbursementFormNote = [values.reimbursementFormNote?.trim() || "", ...automaticRemarks]
          .filter((value, index, entries) => value && entries.indexOf(value) === index)
          .join("\n");
        if (automaticRemarks.length) form.setFieldValue("reimbursementFormNote", reimbursementFormNote);
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
            reimbursementFormNote,
          },
        });
        return true;
      },
      (registered) => {
        if (registered) onRegistered();
      },
    );
  }

  async function handleUpload(kind: "settlement" | "reimbursement", file: File) {
    if (save.pending) return false;
    await upload.run(
      () => uploadWorkflowAttachment(target.id, kind, file),
      (attachment) => {
        if (kind === "settlement") setSettlementAttachment(attachment ?? null);
        else setReimbursementAttachment(attachment ?? null);
      },
    );
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
          <Button icon={<UploadOutlined aria-hidden />} loading={upload.pending} size="small">
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
      name={`workflow-registration-${target.id}`}
      disabled={save.pending || upload.pending}
      form={form}
      initialValues={registrationInitialValues(target)}
      layout="vertical"
      onFinish={() => void submitRegistration()}
    >
      {save.error || upload.error ? (
        <Alert role="alert" showIcon style={{ marginBottom: 12 }} title={save.error || upload.error} type="error" />
      ) : null}
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
              {fundingBookOptions.isError ? (
                <Alert
                  showIcon
                  style={{ marginTop: 8 }}
                  title="无法读取最新版实验申请汇总表；可手动填写经费本编号。"
                  type="warning"
                />
              ) : null}
              <ReimbursementFormFields options={fundingOptions} loading={fundingBookOptions.isLoading} />
              {reimbursementFormReturned && !(reimbursementForms || []).length ? (
                <Alert role="alert" showIcon style={{ marginBottom: 8 }} title="请填写报销单号和金额" type="error" />
              ) : null}
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
        <Button disabled={upload.pending} loading={save.pending} type="primary" onClick={() => void form.submit()}>
          登记并归档
        </Button>
      </Flex>
      <FundingBookConfirmationModal
        otherProjectFundingBooks={fundingBookReview.otherProjectOptions}
        pending={save.pending}
        pi={target.pi}
        unknownFundingBookNos={fundingBookReview.unknownFundingBookNos}
        onCancel={() => setFundingBookReview({ otherProjectOptions: [], unknownFundingBookNos: [] })}
        onConfirm={() => void submitRegistration(true)}
      />
    </Form>
  );
}
