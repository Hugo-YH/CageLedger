import { useState } from "react";
import { Alert, Descriptions, Empty, Flex, Select, Spin, Tag, Typography } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";

import type {
  IntakeBatch,
  IntakeRecognitionImageInput,
  IntakeReviewPreview,
  IntakeReviewResolution,
  IntakeReviewResolutions,
} from "../../../../contracts/intake";
import { intakeStatusLabel } from "../../../../domain/intake";
import { formatPersonNames } from "../../../../domain/personNames";
import { ActionButton, HelpPopover } from "../../../components/ui";
import { formatDateTime, ModalShell } from "../../../components/WorkspaceUi";
import { IntakeReviewComparisons } from "./IntakeReviewComparisons";
import { IntakeReviewEvidence } from "./IntakeReviewEvidence";
import { INTAKE_REVIEW_LABELS as LABELS } from "./intakeReviewLabels";

const OUTCOME = {
  unmatched: "未发现已登记预约",
  registered: "已登记",
  supplement: "可补充原预约",
  conflict: "信息存在差异，请核对课题组与动物信息",
  related: "发现相关预约，请核对完整编号",
  insufficient: "信息不足，暂不能确认一致",
};
type ReviewOption = { value: string; label: string; item: IntakeBatch };
function initialSelection(preview: IntakeReviewPreview) {
  if (preview.items.length === 1) return preview.items[0].item.id;
  const clear = preview.items.filter((item) => item.canAcknowledge || item.canMerge);
  return clear.length === 1 ? clear[0].item.id : "";
}
export function IntakeReviewDialog({
  preview,
  incoming,
  images,
  pending,
  checking = false,
  error,
  blocked,
  requestedResolutions,
  canCreateAnother = false,
  createAnotherPending = false,
  onClose,
  onConfirm,
  onRefresh,
  onAcknowledge,
  onEdit,
  onCreateAnother,
  onResolve,
}: {
  preview: IntakeReviewPreview;
  incoming: IntakeBatch;
  images: IntakeRecognitionImageInput[];
  pending: boolean;
  checking?: boolean;
  error: string;
  blocked: boolean;
  requestedResolutions?: { candidateId: string; values: IntakeReviewResolutions };
  canCreateAnother?: boolean;
  createAnotherPending?: boolean;
  onClose: () => void;
  onConfirm: (id: string) => void;
  onRefresh: () => void;
  onAcknowledge: (id: string) => void;
  onEdit: (id: string) => void;
  onCreateAnother: () => void;
  onResolve?: (id: string, field: string, value: IntakeReviewResolution) => void;
}) {
  const [selectedId, setSelectedId] = useState(() => initialSelection(preview));
  const selected = preview.items.find((candidate) => candidate.item.id === selectedId);
  const close = () => {
    if (!pending) onClose();
  };
  return (
    <ModalShell
      ariaLabel="核对已有预约"
      className="intake-review-dialog"
      width="min(1200px, calc(100vw - 32px))"
      onClose={close}
    >
      <div className="modal-shell-head">
        <div>
          <Flex gap={8} align="center">
            <h2>核对已有预约</h2>
            <HelpPopover label="预约核对说明" icon={<ExclamationCircleOutlined aria-hidden />}>
              数量、品系、规格及完整编号需核对，空缺或无法识别不代表一致。
              字段取值和日期联动以“合并后”为准，确认后才更新已保存预约。关闭会保留本次录入。
            </HelpPopover>
          </Flex>
          <p>先核对差异与合并结果，再确认是否补充原预约。</p>
        </div>
        <ActionButton aria-label="关闭" disabled={pending} onClick={close}>
          关闭
        </ActionButton>
      </div>
      <div className="modal-shell-body">
        <div data-feature="intake" className="intake-review-content">
          <Alert
            showIcon
            type={preview.outcome === "registered" ? "success" : preview.outcome === "conflict" ? "warning" : "info"}
            title={OUTCOME[preview.outcome]}
            description={
              preview.total > 1
                ? `找到 ${preview.total} 条相关记录，请先选择本次要核对的预约。`
                : preview.outcome === "registered"
                  ? "可结束本次录入；如需追加资料，请核对后选择补充原预约。"
                  : "请核对下方重点字段，最终以“合并后”取值为准。"
            }
          />
          {preview.sourceIssues.length ? (
            <Alert
              showIcon
              type="error"
              title="本次来源之间仍有待核对项"
              description={
                <ul className="intake-review-issues">
                  {preview.sourceIssues.map((issue, index) => (
                    <li key={`${issue.field}-${index}`}>
                      {LABELS[issue.field] || issue.field}：{issue.message}
                    </li>
                  ))}
                </ul>
              }
            />
          ) : null}
          {error ? (
            <Alert showIcon type="error" title={error} description="草稿、图片及字段选择已保留，请重新核对后确认。" />
          ) : null}
          <section aria-label="当前核对预约" className="intake-review-current">
            {preview.items.length > 1 ? (
              <div className="intake-review-candidate-picker">
                <Typography.Text strong>选择要核对的预约</Typography.Text>
                <Select<string, ReviewOption>
                  aria-label="选择核对预约"
                  placeholder="请选择已保存的预约"
                  value={selectedId || undefined}
                  disabled={pending}
                  onChange={setSelectedId}
                  options={preview.items.map(({ item }) => ({
                    value: item.id,
                    label: item.orderNo || item.batchNo || item.purchaseOrderNo || "无编号预约",
                    item,
                  }))}
                  optionRender={({ data: { item } }) => (
                    <div data-feature="intake" className="intake-review-candidate-option">
                      <Typography.Text strong>{item.batchNo || "无需求单号"}</Typography.Text>
                      <Typography.Text>
                        订单：{item.orderNo || "未填写"} · 采购：{item.purchaseOrderNo || "未填写"}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {item.iacuc || "伦理未填写"} · {item.intakeDate || "日期待定"} ·{" "}
                        {intakeStatusLabel(item.status)}
                      </Typography.Text>
                    </div>
                  )}
                />
              </div>
            ) : null}
            {selected ? (
              <>
                <div className="intake-review-record">
                  <Flex justify="space-between" align="start" gap={12} wrap>
                    <div className="intake-review-record-title">
                      <Typography.Text strong>已保存预约 · {selected.item.batchNo || "无需求单号"}</Typography.Text>
                      <Typography.Text type="secondary">
                        采购单号：{selected.item.purchaseOrderNo || "未填写"}
                      </Typography.Text>
                    </div>
                    <Flex gap={8} align="center">
                      <Tag>{intakeStatusLabel(selected.item.status)}</Tag>
                      <HelpPopover label="预约匹配说明" icon={<ExclamationCircleOutlined aria-hidden />}>
                        <Flex vertical gap={8}>
                          <span>{selected.reason}</span>
                          <span>订单编号：{selected.item.orderNo || "未填写"}</span>
                          <span>
                            更新时间：{selected.item.updatedAt ? formatDateTime(selected.item.updatedAt) : "未知"}
                          </span>
                        </Flex>
                      </HelpPopover>
                    </Flex>
                  </Flex>
                  <Descriptions
                    size="small"
                    column={{ xs: 1, sm: 2, md: 3 }}
                    items={[
                      { key: "iacuc", label: "IACUC", children: selected.item.iacuc || "未填写" },
                      { key: "pi", label: "项目负责人", children: formatPersonNames(selected.item.pi) || "未填写" },
                      {
                        key: "quantity",
                        label: "动物数量",
                        children: selected.item.quantity == null ? "未确定" : `${selected.item.quantity} 只`,
                      },
                      {
                        key: "strain",
                        label: "品系",
                        children: selected.item.strainStandard || selected.item.strainRaw || "未填写",
                      },
                      { key: "room", label: "饲养房间", children: selected.item.roomName || "未填写" },
                      { key: "date", label: "接收日期", children: selected.item.intakeDate || "未填写" },
                    ]}
                  />
                </div>
                <div className="intake-review-section-head">
                  <Typography.Title level={4}>字段核对</Typography.Title>
                  {checking ? (
                    <Flex role="status" gap={8} align="center">
                      <Spin size="small" />
                      <Typography.Text>正在按字段选择重新核对…</Typography.Text>
                    </Flex>
                  ) : null}
                </div>
                {checking ? (
                  <Typography.Text type="secondary">合并结果仍显示上次预览，完成后才可确认。</Typography.Text>
                ) : null}
                <IntakeReviewComparisons
                  key={selected.item.id}
                  candidate={selected}
                  labels={LABELS}
                  pending={pending}
                  blocked={blocked}
                  requestedResolutions={
                    requestedResolutions?.candidateId === selected.item.id ? requestedResolutions.values : undefined
                  }
                  onResolve={onResolve ? (field, value) => onResolve(selected.item.id, field, value) : undefined}
                />
              </>
            ) : preview.items.length ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="选择一条已保存预约后，查看字段差异与合并结果。"
              />
            ) : null}
          </section>
          <IntakeReviewEvidence
            saved={selected?.item}
            incoming={incoming}
            images={images}
            hasCandidates={preview.items.length > 0}
          />
        </div>
      </div>
      <div
        className="modal-shell-actions intake-review-actions"
        data-feature="intake"
        role="group"
        aria-label="预约核对操作"
      >
        <Flex gap={8} wrap className="intake-review-secondary-actions">
          <ActionButton disabled={pending} onClick={close}>
            返回本次录入
          </ActionButton>
          {selected ? (
            <ActionButton
              tone="tertiary"
              disabled={pending}
              title="打开先前保存的预约；保存后会更新该记录。"
              onClick={() => onEdit(selected.item.id)}
            >
              编辑已保存的预约
            </ActionButton>
          ) : null}
          {error || blocked ? (
            <ActionButton disabled={pending} onClick={onRefresh}>
              重新核对
            </ActionButton>
          ) : null}
        </Flex>
        <Flex gap={8} wrap className="intake-review-confirm-actions">
          {canCreateAnother ? (
            <ActionButton disabled={pending || blocked} loading={createAnotherPending} onClick={onCreateAnother}>
              确认为另一预约，另行保存
            </ActionButton>
          ) : null}
          {selected?.canMerge ? (
            <ActionButton
              tone={selected.canAcknowledge ? "secondary" : "primary"}
              aria-label="确认补充原预约"
              disabled={pending || blocked}
              loading={pending}
              onClick={() => onConfirm(selected.item.id)}
            >
              确认补充原预约
            </ActionButton>
          ) : null}
          {selected?.canAcknowledge ? (
            <ActionButton tone="primary" disabled={pending || blocked} onClick={() => onAcknowledge(selected.item.id)}>
              已登记，结束本次录入
            </ActionButton>
          ) : null}
        </Flex>
      </div>
    </ModalShell>
  );
}
