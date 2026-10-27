import { Alert, Button, Collapse, Image, Space, Typography } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import type { RefObject } from "react";
import type {
  IntakeRecognitionEvidence,
  IntakeRecognitionImageInput,
  IntakeRecognitionSource,
} from "../../../api/contracts";
import { HelpPopover } from "../../../components/ui";
import { IntakeRecognitionReview } from "./IntakeRecognitionReview";

type LocalImage = IntakeRecognitionImageInput & { key: string };

export function IntakeRecognitionHelp() {
  return (
    <HelpPopover
      label="预约消息识别说明"
      placement="bottomLeft"
      icon={<ExclamationCircleOutlined aria-hidden="true" />}
    >
      <Space orientation="vertical" size={8}>
        <Typography.Text>可同时添加饲养需求和采购信息图片，AI 自动分类；支持粘贴或拖入，最多 4 张。</Typography.Text>
        <Typography.Text>
          AI 提取图片事实，品系和规格由系统规范化；数量以采购明细加明确属于本次商品的额外赠送计算，
          本次到货备注用于核对，后续到货和需求总数不计入本次。信息不明确时请核对。
        </Typography.Text>
        <Typography.Text>批次编号或伦理号冲突时请核对。</Typography.Text>
      </Space>
    </HelpPopover>
  );
}

const FIELD_LABELS: Record<string, string> = {
  purchaseOrderNo: "采购单号",
  batchNo: "批次编号",
  iacuc: "IACUC 编号",
  supplier: "购买单位",
  species: "动物种类",
  strainRaw: "原始品系",
  strainStandard: "标准品系",
  specification: "体重/日龄（规格）",
  sex: "性别",
  quantity: "数量（只）",
  roomName: "房间",
  intakeDate: "接收日期",
  husbandryDays: "饲养周期（天）",
  husbandryMonths: "饲养周期（自然月）",
  endDate: "结束日期",
  project: "项目",
  pi: "项目负责人",
  owner: "实验负责人",
  receiverName: "接收人",
  vetPhone: "联系电话",
  notes: "备注",
  suggestedAnimalsPerCage: "每笼建议数量",
  suggestedCardCount: "建议笼卡数",
  finalCardCount: "打印张数",
  intakePurpose: "接收用途",
};

type SourceField = [keyof IntakeRecognitionSource, string];
const HUSBANDRY_FIELDS: SourceField[] = [
  ["iacuc", "IACUC 编号"],
  ["batchNo", "批次编号"],
  ["project", "项目"],
  ["strainRaw", "动物品系"],
  ["approvedQuantity", "可申请总数量（只）"],
  ["remainingQuantity", "剩余许可数量（只）"],
  ["quantity", "本批动物数量（只）"],
  ["maleQuantity", "本批雄性数量（只）"],
  ["femaleQuantity", "本批雌性数量（只）"],
  ["specification", "体重/日龄"],
  ["reviewNotes", "审核备注"],
  ["husbandryDays", "饲养周期（天）"],
  ["husbandryMonths", "饲养周期（自然月）"],
  ["husbandryPeriodRaw", "周期原文"],
  ["roomName", "房间"],
  ["intakePurpose", "接收用途"],
  ["finalCardCount", "打印张数"],
];
const PURCHASE_FIELDS: SourceField[] = [
  ["purchaseOrderNo", "采购单号"],
  ["batchNo", "批次编号"],
  ["productName", "商品名称"],
  ["specification", "规格"],
  ["quantity", "采购数量（只）"],
  ["supplier", "供应商"],
  ["strainRaw", "品系"],
  ["sex", "性别"],
  ["intakeDate", "接收日期"],
  ["endDate", "结束日期"],
];

const GIFT_INCLUSION_LABELS = {
  extra: "额外赠送",
  included: "已包含在明细数量中",
  unknown: "是否额外赠送不明确",
  none: "无赠送",
};
const GIFT_SCOPE_LABELS = { current_item: "本次当前商品", other: "其他批次或商品", unknown: "归属不明确" };

function QuantityFacts({ facts }: { facts: NonNullable<IntakeRecognitionSource["quantityFacts"]> }) {
  const entries: Array<[string, string | number | null | undefined]> = [
    ["明细数量（只）", facts.lineQuantity],
    ["明细数量依据", facts.lineQuantityEvidence],
    ["赠送数量（只）", facts.giftQuantity],
    ["赠送依据", facts.giftEvidence],
    ["赠送情况", facts.giftInclusion ? GIFT_INCLUSION_LABELS[facts.giftInclusion] : undefined],
    ["赠送归属", facts.giftScope ? GIFT_SCOPE_LABELS[facts.giftScope] : undefined],
    ["本次到货备注数量（只）", facts.currentDeliveryQuantity],
    ["本次到货依据", facts.currentDeliveryEvidence],
    ["后续到货备注数量（只）", facts.deferredQuantity],
    ["后续到货依据", facts.deferredEvidence],
    ["采购备注", facts.purchaseNotes],
  ];
  return (
    <ul>
      {entries
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .map(([label, value]) => (
          <li key={label}>
            {label}：{value}
          </li>
        ))}
    </ul>
  );
}

function RecognitionSources({ sources, imageNames }: { sources: IntakeRecognitionSource[]; imageNames: string[] }) {
  return (
    <div>
      {sources.map((source, index) => {
        const title = source.kind === "husbandry" ? "饲养需求" : source.kind === "purchase" ? "采购信息" : "未分类图片";
        const fields =
          source.kind === "husbandry"
            ? HUSBANDRY_FIELDS
            : source.kind === "purchase"
              ? PURCHASE_FIELDS
              : [...HUSBANDRY_FIELDS, ...PURCHASE_FIELDS];
        return (
          <section key={`${source.imageIndex}-${index}`} aria-label={`${title}，图片 ${source.imageIndex}`}>
            <Typography.Text strong>
              {title}（图片 {source.imageIndex}）
            </Typography.Text>
            {imageNames[source.imageIndex - 1] ? (
              <div>
                <Typography.Text type="secondary">来源原图：{imageNames[source.imageIndex - 1]}</Typography.Text>
              </div>
            ) : null}
            <ul>
              {fields
                .filter(([field], fieldIndex) => fields.findIndex(([key]) => key === field) === fieldIndex)
                .map(([field, label]) => {
                  const value = source[field];
                  if (value === null || value === undefined || value === "") {
                    if (field !== "batchNo") return null;
                    return <li key={`${field}-${label}`}>{label}：未识别，需核对</li>;
                  }
                  const display =
                    field === "intakePurpose"
                      ? value === "housing"
                        ? "入驻饲养"
                        : value === "direct_sampling"
                          ? "直接取材"
                          : value
                      : value;
                  return (
                    <li key={`${field}-${label}`}>
                      {label}：{String(display)}
                    </li>
                  );
                })}
            </ul>
            {source.quantityFacts ? <QuantityFacts facts={source.quantityFacts} /> : null}
          </section>
        );
      })}
    </div>
  );
}

export function IntakeRecognitionImages({
  images,
  error,
  evidence,
  onAdd,
  onRemove,
  pickerRef,
}: {
  images: LocalImage[];
  error: string;
  evidence?: IntakeRecognitionEvidence;
  onAdd: (files: File[]) => void;
  onRemove: (key: string) => void;
  pickerRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="intake-recognition-images">
      <input
        ref={pickerRef}
        aria-label="预约图片文件"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(event) => {
          onAdd(Array.from(event.target.files || []));
          event.target.value = "";
        }}
      />
      {error ? <Alert type="error" showIcon title={error} /> : null}
      {evidence ? (
        <IntakeRecognitionReview evidence={evidence}>
          <Collapse
            size="small"
            items={[
              {
                key: "evidence",
                label: "识别依据与留档",
                children: (
                  <Space orientation="vertical" style={{ width: "100%" }}>
                    {evidence.warnings?.length ? (
                      <Collapse
                        size="small"
                        items={[
                          {
                            key: "raw-warnings",
                            label: `原始识别提示（${evidence.warnings.length}条）`,
                            children: (
                              <ul>
                                {evidence.warnings.map((warning, index) => (
                                  <li key={index}>{warning}</li>
                                ))}
                              </ul>
                            ),
                          },
                        ]}
                      />
                    ) : null}
                    {evidence.sources?.length ? (
                      <RecognitionSources
                        sources={evidence.sources}
                        imageNames={
                          evidence.imageIds?.map(
                            (id) => evidence.images?.find((image) => image.id === id)?.name || "",
                          ) || images.map((image) => image.name)
                        }
                      />
                    ) : null}
                    {evidence.quantityCalculation ? (
                      <div>
                        <Typography.Text strong>数量计算</Typography.Text>
                        <ul>
                          <li>明细数量（只）：{evidence.quantityCalculation.baseQuantity ?? "未识别"}</li>
                          <li>赠送数量（只）：{evidence.quantityCalculation.giftQuantity ?? "未识别"}</li>
                          <li>计入赠送（只）：{evidence.quantityCalculation.addedGiftQuantity}</li>
                          <li>实际数量（只）：{evidence.quantityCalculation.actualQuantity ?? "未确定"}</li>
                          {evidence.quantityCalculation.formula ? (
                            <li>计算式：{evidence.quantityCalculation.formula}</li>
                          ) : null}
                          <li>
                            计算状态：{evidence.quantityCalculation.status === "calculated" ? "已计算" : "需核对"}
                          </li>
                          {evidence.quantityCalculation.reason ? (
                            <li>说明：{evidence.quantityCalculation.reason}</li>
                          ) : null}
                        </ul>
                      </div>
                    ) : null}
                    {evidence.extractedText ? (
                      <div>
                        <Typography.Text strong>提取文本</Typography.Text>
                        <pre className="intake-recognition-text">{evidence.extractedText}</pre>
                      </div>
                    ) : null}
                    {Object.keys(evidence.fieldSources || {}).length ? (
                      <div>
                        <Typography.Text strong>字段来源</Typography.Text>
                        <ul>
                          {Object.entries(evidence.fieldSources).map(([field, source]) => (
                            <li key={field}>
                              {FIELD_LABELS[field] || field}：{source}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {evidence.images?.length ? (
                      <div className="intake-image-list">
                        {evidence.images.map((image) => (
                          <div className="intake-image-item" key={image.id}>
                            <Image src={image.url} alt={`已留档 ${image.name}`} width={80} height={80} />
                            <Typography.Text ellipsis>{image.name}</Typography.Text>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </Space>
                ),
              },
            ]}
          />
        </IntakeRecognitionReview>
      ) : null}
      <div className="intake-image-list">
        {images.map((image) => (
          <div className="intake-image-item" key={image.key}>
            <Image src={image.dataUrl} alt={image.name} width={80} height={80} />
            <Typography.Text ellipsis>{image.name}</Typography.Text>
            <Button
              htmlType="button"
              size="small"
              aria-label={`移除图片 ${image.name}`}
              onClick={() => onRemove(image.key)}
            >
              移除
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
