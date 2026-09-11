import { useRef, useState } from "react";
import { Alert, Button, Form, Modal, Space, Tag, Typography } from "antd";
import type { QuarantineBatch, QuarantineDetail, QuarantineTest } from "../../../contracts/quarantine";
import { useQuarantineRecordSave } from "../../api/quarantine";
import { id, methodLabels, reportSections } from "./shared";
import { ReportInformation, ReportProjects, ReportSamples } from "./ReportFields";
import { ReportResults } from "./ReportResults";
import { RecordAttachments } from "./RecordAttachments";

function reportTitle(method: QuarantineTest["method"]) {
  if (method === "parasite") return "体内外寄生虫检测记录表";
  if (method === "pcr") return "PCR 检测记录表";
  return `ELISA 检测记录表（${method === "elisa_rat" ? "大鼠" : "小鼠"}）`;
}

export function TestEditor({
  initial,
  batch,
  detail,
  onCancel,
}: {
  initial: QuarantineTest;
  batch: QuarantineBatch;
  detail: QuarantineDetail;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<QuarantineTest>(() => ({
    ...structuredClone(initial),
    reportFormVersion: 2,
    reportMaterial: initial.reportMaterial ?? [...new Set(initial.samples.map((s) => s.material))].join("、"),
    reportSpecimenState:
      initial.reportSpecimenState ??
      [...new Set(initial.samples.map((s) => s.specimenState))].filter(Boolean).join("、"),
  }));
  const version = useRef(initial.updatedAt);
  const saving = useRef<Promise<QuarantineTest> | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(Boolean(initial.updatedAt));
  const [error, setError] = useState("");
  const [removal, setRemoval] = useState<{ kind: "sample" | "project"; id: string } | null>(null);
  const save = useQuarantineRecordSave();
  const sections = reportSections(draft.method);
  const resultTotal = draft.projects.reduce(
    (count, project) => count + project.sampleIds.length + (draft.method === "parasite" ? 0 : 2),
    0,
  );
  const resultCompleted = draft.projects.reduce(
    (count, project) =>
      count +
      project.sampleIds.filter((sampleId) => project.results[sampleId]).length +
      (draft.method === "parasite" ? 0 : Number(Boolean(project.nc)) + Number(Boolean(project.pc))),
    0,
  );
  const outline = [
    { number: 1, label: "采样实验信息" },
    ...(draft.method === "pcr"
      ? [
          { number: 2, label: "试剂盒名称" },
          { number: 3, label: "试剂盒批号" },
        ]
      : draft.method === "parasite"
        ? []
        : [{ number: 2, label: "试剂盒与批号" }]),
    { number: sections.sample, label: "样本统计表" },
    { number: sections.pictures, label: draft.method === "parasite" ? "显微观察记录" : "原始记录" },
    { number: sections.results, label: "检测结果" },
  ];

  function changeDraft(test: QuarantineTest) {
    setDraft(test);
    setSaved(false);
  }
  function received(test: QuarantineTest) {
    version.current = test.updatedAt;
    setDraft(test);
    setSaved(true);
  }
  async function persist() {
    if (saving.current) return saving.current;
    const pending = save.mutateAsync({ item: draft, version: version.current }).then(({ item }) => {
      received(item);
      setError("");
      return item;
    });
    saving.current = pending;
    try {
      return await pending;
    } finally {
      saving.current = null;
    }
  }
  async function finish() {
    try {
      await persist();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    }
  }
  function addSample() {
    const sample = {
      id: id(),
      number: String(draft.samples.length + 1),
      material: draft.reportMaterial || "",
      specimenState: draft.reportSpecimenState || "",
      poolCount: 1,
      portionCount: 0,
      sourceIds: [] as string[],
    };
    changeDraft({
      ...draft,
      samples: [...draft.samples, sample],
      projects: draft.projects.map((project) => ({
        ...project,
        sampleIds: project.name.includes("（大鼠）") ? project.sampleIds : [...project.sampleIds, sample.id],
      })),
    });
  }
  function addProject() {
    changeDraft({
      ...draft,
      projects: [
        ...draft.projects,
        {
          id: id(),
          name: "新增项目",
          kit: "",
          lot: "",
          sampleIds: draft.samples.map((sample) => sample.id),
          results: {},
          wells: {},
          nc: "",
          pc: "",
        },
      ],
    });
  }
  function remove() {
    if (!removal) return;
    const removedId = removal.id;
    changeDraft(
      removal.kind === "sample"
        ? {
            ...draft,
            samples: draft.samples.filter((sample) => sample.id !== removedId),
            projects: draft.projects.map((project) => ({
              ...project,
              sampleIds: project.sampleIds.filter((sampleId) => sampleId !== removedId),
              results: Object.fromEntries(
                Object.entries(project.results).filter(([sampleId]) => sampleId !== removedId),
              ),
              wells: Object.fromEntries(Object.entries(project.wells).filter(([sampleId]) => sampleId !== removedId)),
            })),
          }
        : { ...draft, projects: draft.projects.filter((project) => project.id !== removedId) },
    );
    setRemoval(null);
  }
  const projects = (fields?: ("name" | "kit" | "lot")[]) => (
    <ReportProjects
      test={draft}
      batch={batch}
      fields={fields}
      onChange={preview ? undefined : changeDraft}
      onRemoveProject={preview ? undefined : (projectId) => setRemoval({ kind: "project", id: projectId })}
    />
  );

  return (
    <div className="quarantine-report-editor">
      <Form layout="vertical" disabled={save.isPending || fileBusy}>
        <div className="quarantine-report-workbar">
          <div>
            <Typography.Text strong>{preview ? "报告预览" : "填写检测记录"}</Typography.Text>
            <Typography.Text type="secondary">
              {saved ? "当前内容已保存" : "内容尚未保存，导出 Word 时沿用原始表格版式"}
            </Typography.Text>
          </div>
          <Space wrap>
            <Button onClick={onCancel}>返回批次</Button>
            <Button onClick={() => setPreview((value) => !value)}>{preview ? "继续填写" : "查看报告预览"}</Button>
            <Button type="primary" loading={save.isPending} onClick={() => void finish()}>
              保存检测草稿
            </Button>
          </Space>
        </div>
        {error && <Alert type="error" title={error} showIcon />}
        <div className="quarantine-report-workspace">
          <aside className="quarantine-report-outline" aria-label="报告章节">
            <Typography.Text type="secondary">本份记录</Typography.Text>
            <Typography.Title level={4}>{methodLabels[draft.method]}</Typography.Title>
            <nav>
              {outline.map((item) => (
                <a key={item.number} href={`#quarantine-part-${item.number}`}>
                  <span>{item.number}</span>
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="quarantine-report-coverage">
              <Typography.Text strong>所属检疫批次</Typography.Text>
              <p>{batch.name}</p>
              <Typography.Text type="secondary">
                覆盖 {batch.sources.length} 个到货来源，抽检实验组见样本统计表。
              </Typography.Text>
            </div>
            <div className="quarantine-report-progress" aria-live="polite">
              <strong>
                {resultCompleted} / {resultTotal}
              </strong>
              <span>结果已填写</span>
            </div>
            <Typography.Paragraph type="secondary">
              先填写试剂盒与样本，再填写结果。新增项目和样本会自动出现在结果表。
            </Typography.Paragraph>
          </aside>
          <main className={`quarantine-report-paper${preview ? " quarantine-report-preview" : ""}`}>
            <div className="quarantine-report-letterhead">
              <span>中山眼科中心眼科学实验动物中心</span>
              <Tag color="blue">{preview ? "报告预览" : "检测记录草稿"}</Tag>
            </div>
            <h1>{reportTitle(draft.method)}</h1>
            <ReportInformation test={draft} onChange={preview ? undefined : changeDraft} />
            {draft.method !== "parasite" && (
              <section id="quarantine-part-2" className="quarantine-report-section">
                <div className="quarantine-report-section-heading">
                  <Typography.Title level={5}>
                    {draft.method === "pcr" ? "2、试剂盒名称" : "2、试剂盒名称及批号"}
                  </Typography.Title>
                  {!preview && (
                    <Button size="small" onClick={addProject}>
                      ＋ 添加检测项目
                    </Button>
                  )}
                </div>
                {projects(draft.method === "pcr" ? ["name", "kit"] : undefined)}
                {draft.method === "pcr" && (
                  <div id="quarantine-part-3" className="quarantine-report-subsection">
                    <Typography.Title level={5}>3、试剂盒批号</Typography.Title>
                    {projects(["name", "lot"])}
                  </div>
                )}
                <Typography.Paragraph type="secondary" className="quarantine-report-hint">
                  检测项目会同步到图片区和结果表，修改名称不会清空已填结果。
                </Typography.Paragraph>
              </section>
            )}
            <section id={`quarantine-part-${sections.sample}`} className="quarantine-report-section">
              <div className="quarantine-report-section-heading">
                <Typography.Title level={5}>{sections.sample}、样本统计表</Typography.Title>
                {!preview && (
                  <Button size="small" onClick={addSample}>
                    ＋ 添加样本
                  </Button>
                )}
              </div>
              <ReportSamples
                test={draft}
                batch={batch}
                onChange={preview ? undefined : changeDraft}
                onRemoveSample={preview ? undefined : (sampleId) => setRemoval({ kind: "sample", id: sampleId })}
              />
            </section>
            <section id={`quarantine-part-${sections.pictures}`} className="quarantine-report-section">
              <Typography.Title level={5}>
                {sections.pictures}、
                {draft.method === "parasite"
                  ? "显微观察记录"
                  : draft.method === "pcr"
                    ? "凝胶成像分析系统原始记录"
                    : "原始记录"}
              </Typography.Title>
              <RecordAttachments
                test={draft}
                attachments={detail.attachments}
                persist={preview ? undefined : persist}
                onVersion={preview ? undefined : received}
                busy={save.isPending || fileBusy}
                onBusy={setFileBusy}
              />
            </section>
            {draft.method === "parasite" && (
              <section className="quarantine-report-section">
                <div className="quarantine-report-section-heading">
                  <Typography.Title level={5}>检测项目</Typography.Title>
                  {!preview && (
                    <Button size="small" onClick={addProject}>
                      ＋ 添加检测项目
                    </Button>
                  )}
                </div>
                {projects()}
              </section>
            )}
            <ReportResults test={draft} onChange={preview ? undefined : changeDraft} sectionNumber={sections.results} />
            <footer className="quarantine-signatures">
              <span>检测人：____________</span>
              <span>复核人：____________</span>
              <span>日期：____________</span>
            </footer>
            <Typography.Paragraph type="secondary" className="quarantine-report-paper-note">
              签名栏固定留空，供导出后手写签名。
            </Typography.Paragraph>
          </main>
        </div>
      </Form>
      <Modal
        open={Boolean(removal)}
        title={removal?.kind === "sample" ? "删除此实验组？" : "删除此检测项目？"}
        onCancel={() => setRemoval(null)}
        onOk={remove}
        okText="确认删除"
      >
        <p>对应结果也会移除，其他实验组和项目的结果不变。如果已有图片关联，请先在原始记录中解除关联。</p>
      </Modal>
    </div>
  );
}
