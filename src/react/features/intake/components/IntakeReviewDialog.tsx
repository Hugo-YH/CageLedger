import { useState } from "react";
import { Alert, Card, Collapse, Flex, Image, Table, Tag, Typography, type TableProps } from "antd";

import type {
  IntakeBatch,
  IntakeRecognitionImageInput,
  IntakeReviewCandidate,
  IntakeReviewPreview,
} from "../../../../contracts/intake";
import { intakePurposeLabel, intakeStatusLabel, speciesLabel } from "../../../../domain/intake";
import { ActionButton } from "../../../components/ui";
import { ModalShell } from "../../../components/WorkspaceUi";
import { IntakeRecognitionReview } from "./IntakeRecognitionReview";
import { RecognitionSources } from "./IntakeRecognitionImages";

const LABELS: Record<string, string> = {
  purchaseOrderNo: "采购单号",
  orderNo: "订单编号",
  batchNo: "需求单号",
  identifiers: "完整编号集合",
  iacuc: "IACUC",
  quantity: "动物数量",
  strainRaw: "原始品系",
  strainStandard: "标准品系",
  strain: "品系/商品名",
  specification: "规格",
  sex: "性别",
  species: "物种",
  intakePurpose: "接收用途",
  intakeDate: "接收日期",
  roomName: "房间",
  supplier: "供应商",
  pi: "项目负责人",
  owner: "实验负责人",
  project: "项目",
  notes: "备注",
  rawMessage: "预约原文",
  recognition: "识别依据",
  husbandryDays: "饲养天数",
  husbandryMonths: "饲养月数",
  endDate: "结束日期",
  finalCardCount: "打印张数",
  receiverName: "接收人",
  vetPhone: "联系电话",
};
const STATUS = { same: "一致", different: "不一致", missing: "本次缺失", supplement: "可补充", unknown: "无法确认" };
const OUTCOME = {
  unmatched: "未发现已登记预约",
  registered: "已登记",
  supplement: "可补充原预约",
  conflict: "信息存在差异，请核对课题组与动物信息",
  related: "发现相关预约，请核对完整编号",
  insufficient: "信息不足，暂不能确认一致",
};
function valueText(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return "未填写";
  if (field === "intakePurpose" && typeof value === "string") return intakePurposeLabel(value);
  if (field === "species" && typeof value === "string") return speciesLabel(value);
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
type Comparison = IntakeReviewCandidate["comparisons"][number];
const columns: TableProps<Comparison>["columns"] = [
  { title: "字段", dataIndex: "field", width: 120, render: (field: string) => LABELS[field] || field },
  { title: "原预约", dataIndex: "before", render: (value, row) => valueText(value, row.field) },
  { title: "本次识别", dataIndex: "incoming", render: (value, row) => valueText(value, row.field) },
  {
    title: "核对结果",
    dataIndex: "status",
    width: 120,
    render: (status: Comparison["status"]) => (
      <Tag color={status === "different" ? "error" : status === "same" ? "success" : undefined}>{STATUS[status]}</Tag>
    ),
  },
];
function initialSelection(preview: IntakeReviewPreview) {
  if (preview.items.length === 1) return preview.items[0].item.id;
  const clear = preview.items.filter((item) => item.canAcknowledge || item.canMerge);
  return clear.length === 1 ? clear[0].item.id : "";
}
function OriginalEvidence({ item }: { item: IntakeBatch }) {
  const images = item.recognition?.images || [];
  const rounds = item.recognition?.recognitionRounds || [];
  return (
    <Collapse
      items={[
        {
          key: "original",
          label: "原预约原文与图片",
          children: (
            <Flex vertical gap={8}>
              <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                {item.rawMessage || "无原文"}
              </Typography.Paragraph>
              <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                {item.recognition?.extractedText || ""}
              </Typography.Paragraph>
              {item.recognition ? <IntakeRecognitionReview evidence={item.recognition} /> : null}
              {item.recognition?.sources?.length ? (
                <RecognitionSources
                  sources={item.recognition.sources}
                  imageNames={
                    item.recognition.imageIds?.map((id) => images.find((image) => image.id === id)?.name || "") || []
                  }
                />
              ) : null}
              <Image.PreviewGroup>
                <Flex gap={8} wrap>
                  {images.map((image) => (
                    <Image key={image.id} width={140} src={image.url} alt={`原预约图片：${image.name}`} />
                  ))}
                </Flex>
              </Image.PreviewGroup>
            </Flex>
          ),
        },
        ...rounds.map((round, index) => ({
          key: `round-${index}`,
          label: `识别依据 ${index + 1} · ${round.at}`,
          children: (
            <Flex vertical gap={8}>
              <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                {round.rawMessage || "无原文"}
              </Typography.Paragraph>
              <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                {round.evidence.extractedText || ""}
              </Typography.Paragraph>
              <IntakeRecognitionReview evidence={round.evidence} />
              {round.evidence.sources?.length ? (
                <RecognitionSources
                  sources={round.evidence.sources}
                  imageNames={round.imageIds.map((id) => images.find((image) => image.id === id)?.name || "")}
                />
              ) : null}
              <Typography.Text>
                本轮图片：
                {round.imageIds.map((id) => images.find((image) => image.id === id)?.name || id).join("、") || "无"}
              </Typography.Text>
              <Typography.Text>
                补充字段：{round.appliedFields.map((field) => LABELS[field] || field).join("、") || "仅留档依据"}
              </Typography.Text>
            </Flex>
          ),
        })),
      ]}
    />
  );
}

export function IntakeReviewDialog({
  preview,
  incoming,
  images,
  pending,
  error,
  blocked,
  canCreateAnother = false,
  onClose,
  onConfirm,
  onRefresh,
  onAcknowledge,
  onEdit,
  onCreateAnother,
}: {
  preview: IntakeReviewPreview;
  incoming: IntakeBatch;
  images: IntakeRecognitionImageInput[];
  pending: boolean;
  error: string;
  blocked: boolean;
  canCreateAnother?: boolean;
  onClose: () => void;
  onConfirm: (id: string) => void;
  onRefresh: () => void;
  onAcknowledge: (id: string) => void;
  onEdit: (id: string) => void;
  onCreateAnother: () => void;
}) {
  const [selectedId, setSelectedId] = useState(() => initialSelection(preview));
  const selected = preview.items.find((candidate) => candidate.item.id === selectedId);
  const close = () => {
    if (!pending) onClose();
  };
  return (
    <ModalShell ariaLabel="核对已有预约" width="min(1100px, calc(100vw - 32px))" onClose={close}>
      <div className="modal-shell-head">
        <div>
          <h2>核对已有预约</h2>
          <p>核对原记录与本次来源；结束本次录入不会改动原预约。</p>
        </div>
        <ActionButton disabled={pending} onClick={close}>
          关闭
        </ActionButton>
      </div>
      <div className="modal-shell-body">
        <Flex vertical gap={16}>
          <Alert
            showIcon
            type={preview.outcome === "registered" ? "success" : "warning"}
            title={OUTCOME[preview.outcome]}
            description={
              preview.total > 1
                ? `找到 ${preview.total} 条相关记录，请选择要查看的原预约；不会自动选择或合并其他记录。`
                : "数量、标准品系、规格及完整编号必须可确认；空缺和无法识别的信息不代表一致。补充仅填原预约空缺，已有非空值保持原值。"
            }
          />
          {preview.sourceIssues.length ? (
            <Alert
              showIcon
              type="error"
              title="本次来源之间仍有待核对项"
              description={
                <ul>
                  {preview.sourceIssues.map((issue, index) => (
                    <li key={`${issue.field}-${index}`}>
                      {LABELS[issue.field] || issue.field}：{issue.message}
                    </li>
                  ))}
                </ul>
              }
            />
          ) : null}
          <Collapse
            items={[
              {
                key: "incoming",
                label: "本次原文与图片",
                children: (
                  <Flex vertical gap={8}>
                    <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                      {incoming.rawMessage || "无原文"}
                    </Typography.Paragraph>
                    <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                      {incoming.recognition?.extractedText || ""}
                    </Typography.Paragraph>
                    {incoming.recognition ? <IntakeRecognitionReview evidence={incoming.recognition} /> : null}
                    {incoming.recognition?.sources?.length ? (
                      <RecognitionSources
                        sources={incoming.recognition.sources}
                        imageNames={images.map((image) => image.name)}
                      />
                    ) : null}
                    <Image.PreviewGroup>
                      <Flex gap={8} wrap>
                        {images.map((image, index) => (
                          <Image key={index} width={140} src={image.dataUrl} alt={`本次图片：${image.name}`} />
                        ))}
                      </Flex>
                    </Image.PreviewGroup>
                  </Flex>
                ),
              },
            ]}
          />
          {preview.items.map((candidate) => (
            <Card
              key={candidate.item.id}
              size="small"
              title={`${candidate.item.batchNo || "无需求单号"} · ${candidate.item.purchaseOrderNo || "无采购单号"}`}
              extra={
                preview.items.length > 1 ? (
                  <ActionButton disabled={pending} onClick={() => setSelectedId(candidate.item.id)}>
                    {candidate.item.id === selectedId ? "当前查看" : "查看此预约"}
                  </ActionButton>
                ) : undefined
              }
            >
              <Flex vertical gap={12}>
                <Typography.Text>
                  订单编号：{candidate.item.orderNo || "未填写"}；状态：{intakeStatusLabel(candidate.item.status)}
                </Typography.Text>
                <Typography.Text type="secondary">更新时间：{candidate.item.updatedAt || "未知"}</Typography.Text>
                <Typography.Text>{candidate.reason}</Typography.Text>
                {selectedId === candidate.item.id ? (
                  <>
                    <Table
                      columns={columns}
                      dataSource={candidate.comparisons}
                      rowKey="field"
                      pagination={false}
                      scroll={{ x: 700 }}
                      size="small"
                    />
                    <OriginalEvidence item={candidate.item} />
                    <ActionButton disabled={pending} onClick={() => onEdit(candidate.item.id)}>
                      在当前页面编辑原预约
                    </ActionButton>
                  </>
                ) : null}
              </Flex>
            </Card>
          ))}
          {error ? (
            <Alert
              showIcon
              type="error"
              title={error}
              description="本次草稿和图片已保留。记录变化后请重新核对，不会自动覆盖新版本。"
            />
          ) : null}
        </Flex>
      </div>
      <div className="modal-shell-actions">
        <ActionButton disabled={pending} onClick={close}>
          返回修改本次草稿
        </ActionButton>
        {error || blocked ? (
          <ActionButton disabled={pending} onClick={onRefresh}>
            重新核对
          </ActionButton>
        ) : null}
        {canCreateAnother ? (
          <ActionButton disabled={pending || blocked} onClick={onCreateAnother}>
            确认为另一预约，另行保存
          </ActionButton>
        ) : null}
        {selected?.canMerge ? (
          <ActionButton disabled={pending || blocked} loading={pending} onClick={() => onConfirm(selected.item.id)}>
            确认补充原预约
          </ActionButton>
        ) : null}
        {selected?.canAcknowledge ? (
          <ActionButton tone="primary" disabled={pending || blocked} onClick={() => onAcknowledge(selected.item.id)}>
            已登记，结束本次录入
          </ActionButton>
        ) : null}
      </div>
    </ModalShell>
  );
}
