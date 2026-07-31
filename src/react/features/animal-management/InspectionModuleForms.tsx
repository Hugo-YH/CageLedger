import { Button, Card, Collapse, Space, Tag } from "antd";

import type { InspectionAnswer, InspectionCatalogNode, InspectionModuleCode } from "../../api/contracts";
import { HelpTooltip } from "../../components/Tooltip";
import type { ReferencePreview } from "./InspectionDialogs";
import {
  abnormalAnimalBodyRegions,
  groupedItems,
  inspectionAnswerKey,
  inspectionOutcome,
  MODULE_LABELS,
} from "./model";

const MODULE_ANNOTATIONS: Partial<Record<InspectionModuleCode, string>> = {
  basicAssessment: "设施与福利",
  advancedAssessment: "操作与伦理",
};

export function InspectionModuleForm({
  moduleCode,
  nodes,
  answerMap,
  onAnswer,
  onFinding,
  onReference,
}: {
  moduleCode: InspectionModuleCode;
  nodes: InspectionCatalogNode[];
  answerMap: Record<string, InspectionAnswer>;
  onAnswer: (node: InspectionCatalogNode, patch: Partial<InspectionAnswer>) => void;
  onFinding: (node: InspectionCatalogNode) => void;
  onReference: (preview: ReferencePreview) => void;
}) {
  return (
    <Card
      className="animal-ant-card inspection-module-card"
      data-module={moduleCode}
      aria-labelledby={`inspection-module-${moduleCode}`}
      size="small"
      styles={{ body: { padding: 0 } }}
      title={
        <span className="inspection-module-card-title">
          <span id={`inspection-module-${moduleCode}`}>{MODULE_LABELS[moduleCode]}</span>
          {MODULE_ANNOTATIONS[moduleCode] ? (
            <Tag color="blue" variant="filled">
              {MODULE_ANNOTATIONS[moduleCode]}
            </Tag>
          ) : null}
          <HelpTooltip label={`${MODULE_LABELS[moduleCode]}巡检说明`}>
            每个条目选择正常或异常；确认异常后补充定位、图例对照和现场照片。
          </HelpTooltip>
        </span>
      }
    >
      {moduleCode === "abnormalAnimalAssessment"
        ? abnormalAnimalBodyRegions(nodes).map((region) => (
            <InspectionBodyRegionSection
              answerMap={answerMap}
              key={region.key}
              moduleCode={moduleCode}
              onAnswer={onAnswer}
              onFinding={onFinding}
              onReference={onReference}
              region={region}
            />
          ))
        : groupedItems(nodes, moduleCode).map(([category, items]) => (
            <InspectionCategory
              answerMap={answerMap}
              category={category}
              items={items}
              key={category}
              moduleCode={moduleCode}
              onAnswer={onAnswer}
              onFinding={onFinding}
              onReference={onReference}
            />
          ))}
    </Card>
  );
}

function InspectionBodyRegionSection({
  region,
  moduleCode,
  answerMap,
  onAnswer,
  onFinding,
  onReference,
}: {
  region: ReturnType<typeof abnormalAnimalBodyRegions>[number];
  moduleCode: InspectionModuleCode;
  answerMap: Record<string, InspectionAnswer>;
  onAnswer: (node: InspectionCatalogNode, patch: Partial<InspectionAnswer>) => void;
  onFinding: (node: InspectionCatalogNode) => void;
  onReference: (preview: ReferencePreview) => void;
}) {
  const items = region.groups.flatMap((group) => group.items);
  const answered = items.filter((node) => Boolean(answerMap[inspectionAnswerKey(moduleCode, node.code)])).length;
  const findings = items.filter(
    (node) => inspectionOutcome(answerMap[inspectionAnswerKey(moduleCode, node.code)]) === "abnormal",
  ).length;
  const stateLabel = findings
    ? `${findings} 项异常`
    : answered === items.length
      ? `已确认 ${answered}/${items.length}`
      : `待确认 ${answered}/${items.length}`;

  return (
    <section
      className={`inspection-body-region ${findings ? "has-findings" : ""}`}
      aria-label={`${region.name}异常动物评估`}
    >
      <Collapse
        className="inspection-body-region-collapse"
        bordered
        expandIconPlacement="end"
        size="small"
        items={[
          {
            key: region.key,
            label: (
              <span className="inspection-body-region-label">
                <span className="inspection-body-region-label-main">
                  <strong>{region.name}</strong>
                  <Tag variant="filled">{region.description}</Tag>
                </span>
                <Space size={8}>
                  <Tag color={findings ? "error" : answered === items.length ? "success" : "default"}>{stateLabel}</Tag>
                  <span className="inspection-body-region-count">{region.itemCount} 项</span>
                </Space>
              </span>
            ),
            children: region.groups.map((group) => (
              <InspectionCategory
                answerMap={answerMap}
                category={group.name}
                items={group.items}
                key={group.key}
                moduleCode={moduleCode}
                onAnswer={onAnswer}
                onFinding={onFinding}
                onReference={onReference}
              />
            )),
          },
        ]}
      />
    </section>
  );
}

function InspectionCategory({
  category,
  items,
  moduleCode,
  answerMap,
  onAnswer,
  onFinding,
  onReference,
}: {
  category: string;
  items: InspectionCatalogNode[];
  moduleCode: InspectionModuleCode;
  answerMap: Record<string, InspectionAnswer>;
  onAnswer: (node: InspectionCatalogNode, patch: Partial<InspectionAnswer>) => void;
  onFinding: (node: InspectionCatalogNode) => void;
  onReference: (preview: ReferencePreview) => void;
}) {
  const answered = items.filter((node) => Boolean(answerMap[inspectionAnswerKey(moduleCode, node.code)])).length;
  const findings = items.filter(
    (node) => inspectionOutcome(answerMap[inspectionAnswerKey(moduleCode, node.code)]) === "abnormal",
  ).length;
  const stateLabel = findings
    ? `${findings} 项异常`
    : answered === items.length
      ? `已确认 ${answered}/${items.length}`
      : `待确认 ${answered}/${items.length}`;
  return (
    <section className={`inspection-category ${findings ? "has-findings" : ""}`} aria-label={category}>
      <div className="inspection-category-head">
        <div className="inspection-category-title">
          <h3>{category}</h3>
          <Tag color={findings ? "error" : answered === items.length ? "success" : "default"}>{stateLabel}</Tag>
          <Button
            className="inspection-all-normal"
            size="small"
            type="link"
            onClick={() => items.forEach((node) => onAnswer(node, { outcome: "normal" }))}
          >
            全部正常
          </Button>
        </div>
      </div>
      <Collapse
        className="inspection-category-collapse"
        expandIconPlacement="start"
        ghost
        items={[
          {
            key: "items",
            label: (
              <span className="inspection-category-collapse-label">
                <span>查看检查项</span>
                <Tag variant="filled">{items.length} 项</Tag>
              </span>
            ),
            children: (
              <div className="inspection-category-items">
                {items.map((node) => {
                  const key = inspectionAnswerKey(moduleCode, node.code);
                  const answer = answerMap[key];
                  // A missing answer remains visibly pending until the inspector confirms it.
                  const outcome = answer ? inspectionOutcome(answer) : undefined;
                  const images = node.config?.referenceImages || [];
                  return (
                    <article
                      className={`inspection-node ${outcome === "abnormal" ? "has-finding" : ""}`}
                      key={node.code}
                    >
                      <div className="inspection-node-main">
                        <div className="inspection-node-title">
                          <strong>{node.name}</strong>
                          {images.length ? (
                            <Button
                              className="inspection-reference-trigger"
                              size="small"
                              type="link"
                              onClick={() => onReference({ images, initialIndex: 0, title: node.name })}
                            >
                              图例 {images.length}
                            </Button>
                          ) : null}
                        </div>
                        <Space.Compact
                          className="inspection-outcome-options"
                          role="group"
                          aria-label={`${node.name}巡检结论`}
                        >
                          <Button
                            aria-pressed={outcome === "normal"}
                            className="normal"
                            size="small"
                            type={outcome === "normal" ? "primary" : "default"}
                            onClick={() => onAnswer(node, { outcome: "normal" })}
                          >
                            正常
                          </Button>
                          <Button
                            aria-pressed={outcome === "abnormal"}
                            className="abnormal"
                            danger
                            size="small"
                            type={outcome === "abnormal" ? "primary" : "default"}
                            onClick={() => onFinding(node)}
                          >
                            异常
                          </Button>
                        </Space.Compact>
                        {node.description ? <p>{node.description}</p> : null}
                      </div>
                      {outcome === "abnormal" ? (
                        <div className="inspection-finding-summary">
                          <strong>已登记异常</strong>
                          <span>
                            {answer?.locationHint ||
                              answer?.animalIdentifier ||
                              answer?.note ||
                              "已登记，可点击异常修改。"}
                          </span>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}
