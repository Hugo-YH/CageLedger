/**
 * 历史文字补充弹窗；当前录入使用 IntakeReviewDialog，不从此组件推断现役交互。
 * 保留边界见 docs/contracts/frontend-lifecycle.json 与 docs/contracts/current-baseline.md。
 */
import { Alert, Card, Flex, Image, Table, Tag, Typography, type TableProps } from "antd";

import type { IntakeRecognitionMergeCandidate, IntakeRecognitionMergePreview } from "../../../../contracts/intake";
import { intakeStatusLabel, normalizeIntakeOrderIdentifiers } from "../../../../domain/intake";
import { ActionButton } from "../../../components/ui";
import { ModalShell } from "../../../components/WorkspaceUi";

const FIELD_LABELS: Record<string, string> = {
  rawMessage: "预约文字",
  purchaseOrderNo: "采购单号",
  orderNo: "订单编号",
  batchNo: "批次号",
  iacuc: "IACUC",
  intakePurpose: "接收用途",
  supplier: "供应商",
  species: "物种",
  strainRaw: "原始品系",
  strainStandard: "标准品系",
  specification: "规格",
  sex: "性别",
  quantity: "动物数量",
  roomName: "房间",
  roomMatched: "房间匹配",
  intakeDate: "接收日期",
  husbandryDays: "饲养天数",
  husbandryMonths: "饲养月数",
  endDate: "结束日期",
  project: "项目",
  pi: "项目负责人",
  owner: "实验负责人",
  receiverName: "接收人",
  vetPhone: "兽医电话",
  notes: "备注",
  finalCardCount: "打印张数",
  suggestedAnimalsPerCage: "建议每笼数量",
  suggestedCardCount: "建议笼数",
  status: "状态",
  confirmedCardCount: "已确认张数",
  remainingCardCount: "待确认张数",
  receipts: "接收记录",
  cards: "笼卡",
  recognition: "识别依据",
};

function valueText(value: unknown) {
  if (value === null || value === undefined || value === "") return "未填写";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

type Change = IntakeRecognitionMergeCandidate["changes"][number];
const columns: TableProps<Change>["columns"] = [
  { title: "字段", dataIndex: "field", width: 115, render: (field: string) => FIELD_LABELS[field] || field },
  { title: "原预约", dataIndex: "before", render: valueText },
  { title: "本次文字识别", dataIndex: "incoming", render: valueText },
  { title: "确认后", dataIndex: "after", render: valueText },
  {
    title: "采用依据",
    dataIndex: "source",
    width: 100,
    render: (source: Change["source"]) => (
      <Tag>{source === "image" ? "图片" : source === "text" ? "文字补充" : "原记录"}</Tag>
    ),
  },
];

export function IntakeRecognitionMergeDialog({
  preview,
  pending,
  error,
  blocked = false,
  onClose,
  onConfirm,
  onRefresh,
}: {
  preview: IntakeRecognitionMergePreview;
  pending: boolean;
  error: string;
  blocked?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onRefresh: () => void;
}) {
  const candidate = preview.items[0];
  const canMerge =
    preview.total === 1 &&
    preview.items.length === 1 &&
    candidate?.canMerge &&
    Boolean(candidate.mergedItem && candidate.confirmationToken);
  const close = () => {
    if (!pending) onClose();
  };
  return (
    <ModalShell ariaLabel="核对已有图片预约" width="min(1100px, calc(100vw - 32px))" onClose={close}>
      <div className="modal-shell-head">
        <div>
          <h2>核对已有图片预约</h2>
          <p>以图片为准，文字补充；确认后更新原预约，不新建重复记录。</p>
        </div>
        <ActionButton disabled={pending} onClick={close}>
          关闭
        </ActionButton>
      </div>
      <div className="modal-shell-body">
        <Flex vertical gap={16}>
          <Alert
            showIcon
            type={canMerge ? "info" : "warning"}
            title={canMerge ? "请核对合并前后信息" : "匹配记录不能直接合并"}
            description={
              canMerge
                ? "图片及原记录中的已有信息优先保留，文字仅补充缺项。取消将保留本次文字识别草稿。"
                : `共匹配 ${preview.total} 条记录。请核对以下原因；取消后仍可修改或按原重复确认流程保存草稿。`
            }
          />
          {preview.items.map((match) => (
            <Card
              key={match.item.id}
              size="small"
              title={`${match.item.batchNo || "无批次号"} · ${normalizeIntakeOrderIdentifiers(match.item).purchaseOrderNo || "无采购单号"}`}
            >
              <Flex vertical gap={12}>
                <Typography.Text>
                  订单编号：{normalizeIntakeOrderIdentifiers(match.item).orderNo || "未填写"}
                </Typography.Text>
                <Typography.Text>
                  匹配：{match.matchedFields.map((field) => FIELD_LABELS[field]).join("、")}；状态：
                  {intakeStatusLabel(match.item.status)}
                </Typography.Text>
                {match.reason ? <Typography.Paragraph>{match.reason}</Typography.Paragraph> : null}
                {match.item.recognition?.images?.length ? (
                  <Image.PreviewGroup>
                    <Flex gap={8} wrap>
                      {match.item.recognition.images.map((image) => (
                        <Image key={image.id} width={160} src={image.url} alt={`原预约图片：${image.name}`} />
                      ))}
                    </Flex>
                  </Image.PreviewGroup>
                ) : null}
                {match.changes.length ? (
                  <Table
                    columns={columns}
                    dataSource={match.changes}
                    rowKey="field"
                    pagination={false}
                    scroll={{ x: 760 }}
                    size="small"
                  />
                ) : null}
              </Flex>
            </Card>
          ))}
          {error ? (
            <Alert
              showIcon
              type="error"
              title={error}
              description="文字识别草稿已保留；记录有变化时请重新匹配后再确认。"
            />
          ) : null}
        </Flex>
      </div>
      <div className="modal-shell-actions">
        <ActionButton disabled={pending} onClick={close}>
          取消合并，保留草稿
        </ActionButton>
        {error ? (
          <ActionButton disabled={pending} onClick={onRefresh}>
            重新匹配
          </ActionButton>
        ) : null}
        {canMerge ? (
          <ActionButton disabled={pending || blocked} loading={pending} tone="primary" onClick={onConfirm}>
            确认更新原预约
          </ActionButton>
        ) : null}
      </div>
    </ModalShell>
  );
}
