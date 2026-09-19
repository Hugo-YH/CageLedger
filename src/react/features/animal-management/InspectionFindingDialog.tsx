import { useId, useState } from "react";
import { Alert, Button, Descriptions, Form, Input, Modal, Select, Space } from "antd";

import type { FindingStatus, InspectionFinding } from "../../api/contracts";
import { useResolveFinding, useUpdateFinding } from "../../api/animalManagement";
import { DateInput } from "../../components/ui";
import { useAsyncFormAction } from "../../hooks/useAsyncFormAction";
import { FINDING_STATUS_LABELS, findingLocation } from "./model";

export function FindingDialog({ finding, onClose }: { finding: InspectionFinding; onClose: () => void }) {
  const formId = useId();
  const [status, setStatus] = useState<FindingStatus>(finding.status);
  const [actionNote, setActionNote] = useState(finding.actionNote || "");
  const [responsibleName, setResponsibleName] = useState(finding.responsibleName || "");
  const [recheckDueAt, setRecheckDueAt] = useState(finding.recheckDueAt || "");
  const [conclusion, setConclusion] = useState("");
  const update = useUpdateFinding();
  const resolve = useResolveFinding();
  const action = useAsyncFormAction("处置操作失败，请重试");
  const [notice, setNotice] = useState("");
  async function save() {
    setNotice("");
    await action.run(
      () => update.mutateAsync({ id: finding.id, status, actionNote, responsibleName, recheckDueAt }),
      () => setNotice("处置记录已保存。"),
    );
  }
  async function closeFinding() {
    setNotice("");
    await action.run(() => resolve.mutateAsync({ id: finding.id, conclusion }), onClose);
  }
  return (
    <Modal
      cancelButtonProps={{ disabled: action.pending }}
      cancelText="取消"
      centered
      className="inspection-action-modal"
      closable={!action.pending}
      destroyOnHidden
      keyboard={!action.pending}
      okButtonProps={{ loading: update.isPending, disabled: action.pending }}
      okText="保存处置"
      onCancel={() => {
        if (!action.pending) onClose();
      }}
      onOk={() => void save()}
      open
      title="异常处置"
      width={720}
      footer={(_, { CancelBtn, OkBtn }) => (
        <Space wrap>
          <CancelBtn />
          <OkBtn />
          <Button
            danger
            disabled={action.pending || !conclusion.trim()}
            loading={resolve.isPending}
            onClick={() => void closeFinding()}
          >
            确认关闭
          </Button>
        </Space>
      )}
    >
      <Descriptions className="inspection-action-summary" column={{ xs: 1, sm: 2 }} size="small">
        <Descriptions.Item label="饲养间">{finding.roomName}</Descriptions.Item>
        <Descriptions.Item label="异常项目">{finding.nodeCode}</Descriptions.Item>
        <Descriptions.Item label="定位信息" span={{ xs: 1, sm: 2 }}>
          {findingLocation(finding)}
        </Descriptions.Item>
      </Descriptions>
      <Form className="inspection-action-form" layout="vertical" disabled={action.pending}>
        <Form.Item label="处置状态" htmlFor={`${formId}-status`}>
          <Select<FindingStatus>
            id={`${formId}-status`}
            options={Object.entries(FINDING_STATUS_LABELS).map(([value, label]) => ({
              label,
              value: value as FindingStatus,
            }))}
            value={status}
            onChange={setStatus}
          />
        </Form.Item>
        <Form.Item label="实际措施" htmlFor={`${formId}-action`}>
          <Input.TextArea
            id={`${formId}-action`}
            rows={3}
            value={actionNote}
            onChange={(event) => setActionNote(event.target.value)}
          />
        </Form.Item>
        <div className="inspection-action-fields">
          <Form.Item label="责任人" htmlFor={`${formId}-responsible`}>
            <Input
              id={`${formId}-responsible`}
              value={responsibleName}
              onChange={(event) => setResponsibleName(event.target.value)}
            />
          </Form.Item>
          <Form.Item label="复查日期">
            <DateInput label="复查日期" value={recheckDueAt} onChange={setRecheckDueAt} />
          </Form.Item>
        </div>
        <Form.Item label="关闭结论" htmlFor={`${formId}-conclusion`}>
          <Input.TextArea
            id={`${formId}-conclusion`}
            rows={3}
            value={conclusion}
            onChange={(event) => setConclusion(event.target.value)}
          />
        </Form.Item>
      </Form>
      {action.error ? <Alert role="alert" title={action.error} showIcon type="error" /> : null}
      {notice ? <Alert role="status" title={notice} showIcon type="success" /> : null}
      <Alert
        className="inspection-action-note"
        description="医疗、安乐死与给药建议作为人工参考，处置前执行兽医与伦理审核。"
        showIcon
        type="warning"
      />
    </Modal>
  );
}
