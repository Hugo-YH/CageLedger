import { Col, Collapse, Flex, Image, Row, Typography } from "antd";
import type { IntakeBatch, IntakeRecognitionImageInput } from "../../../../contracts/intake";
import { IntakeRecognitionReview } from "./IntakeRecognitionReview";
import { RecognitionSources } from "./IntakeRecognitionImages";
import { INTAKE_REVIEW_LABELS } from "./intakeReviewLabels";

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
                补充字段：
                {round.appliedFields.map((field) => INTAKE_REVIEW_LABELS[field] || field).join("、") || "仅留档依据"}
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

export function IntakeReviewEvidence({
  saved,
  incoming,
  images,
  hasCandidates,
}: {
  saved?: IntakeBatch;
  incoming: IntakeBatch;
  images: IntakeRecognitionImageInput[];
  hasCandidates: boolean;
}) {
  return (
    <section aria-label="预约来源材料" className="intake-review-evidence">
      <Flex align="center" justify="space-between" gap={8} wrap className="intake-review-section-head">
        <Typography.Title level={4}>原文与图片</Typography.Title>
        <Typography.Text type="secondary">按需展开，对照原始资料</Typography.Text>
      </Flex>
      <Row gutter={[0, 12]}>
        <Col xs={24} md={12} className="intake-review-evidence-saved">
          {saved ? (
            <OriginalEvidence key={saved.id} item={saved} />
          ) : (
            <Typography.Text type="secondary">
              {hasCandidates ? "请选择要核对的已保存预约。" : "暂无匹配的已保存预约。"}
            </Typography.Text>
          )}
        </Col>
        <Col xs={24} md={12} className="intake-review-evidence-incoming">
          <IncomingEvidence item={incoming} images={images} />
        </Col>
      </Row>
    </section>
  );
}
