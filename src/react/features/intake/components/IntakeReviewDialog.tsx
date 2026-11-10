import { useState } from "react";
import { Alert, Card, Col, Collapse, Flex, Image, Row, Typography } from "antd";

import type {
  IntakeBatch,
  IntakeRecognitionImageInput,
  IntakeReviewPreview,
  IntakeReviewResolution,
  IntakeReviewResolutions,
} from "../../../../contracts/intake";
import { intakeStatusLabel } from "../../../../domain/intake";
import { ActionButton } from "../../../components/ui";
import { ModalShell } from "../../../components/WorkspaceUi";
import { IntakeRecognitionReview } from "./IntakeRecognitionReview";
import { RecognitionSources } from "./IntakeRecognitionImages";
import { IntakeReviewComparisons } from "./IntakeReviewComparisons";

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
const OUTCOME = {
  unmatched: "未发现已登记预约",
  registered: "已登记",
  supplement: "可补充原预约",
  conflict: "信息存在差异，请核对课题组与动物信息",
  related: "发现相关预约，请核对完整编号",
  insufficient: "信息不足，暂不能确认一致",
};
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

function IncomingEvidence({ item, images }: { item: IntakeBatch; images: IntakeRecognitionImageInput[] }) {
  return (
    <Collapse
      items={[
        {
          key: "incoming",
          label: "本次原文与图片",
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
                <RecognitionSources sources={item.recognition.sources} imageNames={images.map((image) => image.name)} />
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
  );
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
    <ModalShell ariaLabel="核对已有预约" width="min(1100px, calc(100vw - 32px))" onClose={close}>
      <div className="modal-shell-head">
        <div>
          <h2>核对已有预约</h2>
          <p>对比已保存的预约和本次录入；关闭后保留本次录入，补充需确认。</p>
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
                : "数量、标准品系、规格及完整编号需核对；空缺和无法识别的信息不代表一致。补充前请查看“合并后”取值及日期计算依据，确认后才更新已保存预约。"
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
          {checking ? (
            <Alert
              showIcon
              type="info"
              title="正在按字段选择重新核对…"
              description="合并结果仍显示上次预览，完成后才可确认。"
            />
          ) : null}
          <section aria-label="预约来源材料">
            <Card size="small" title="来源材料">
              <Row gutter={[16, 16]}>
                <Col xs={24} md={12}>
                  <Flex vertical gap={8}>
                    <Typography.Text strong>已保存的预约</Typography.Text>
                    {selected ? (
                      <OriginalEvidence key={selected.item.id} item={selected.item} />
                    ) : (
                      <Typography.Text type="secondary">
                        {preview.items.length ? "请选择要核对的已保存预约。" : "暂无匹配的已保存预约。"}
                      </Typography.Text>
                    )}
                  </Flex>
                </Col>
                <Col xs={24} md={12}>
                  <Flex vertical gap={8}>
                    <Typography.Text strong>本次录入</Typography.Text>
                    <IncomingEvidence item={incoming} images={images} />
                  </Flex>
                </Col>
              </Row>
            </Card>
          </section>
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
                  <IntakeReviewComparisons
                    candidate={candidate}
                    labels={LABELS}
                    pending={pending}
                    blocked={blocked}
                    requestedResolutions={
                      requestedResolutions?.candidateId === candidate.item.id ? requestedResolutions.values : undefined
                    }
                    onResolve={onResolve ? (field, value) => onResolve(candidate.item.id, field, value) : undefined}
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
              description="本次草稿、图片及字段选择已保留。请重新核对后确认，不会自动覆盖新版本。"
            />
          ) : null}
        </Flex>
      </div>
      <div className="modal-shell-actions" role="group" aria-label="预约核对操作">
        <ActionButton disabled={pending} onClick={close}>
          返回本次录入
        </ActionButton>
        {selected ? (
          <ActionButton
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
        {canCreateAnother ? (
          <ActionButton disabled={pending || blocked} loading={createAnotherPending} onClick={onCreateAnother}>
            确认为另一预约，另行保存
          </ActionButton>
        ) : null}
        {selected?.canMerge ? (
          <ActionButton
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
      </div>
    </ModalShell>
  );
}
