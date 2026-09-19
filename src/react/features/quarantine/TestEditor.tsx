import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Anchor, Button, Card, Descriptions, Form, Modal, Typography } from "antd";
import type { QuarantineBatch, QuarantineDetail, QuarantineTest } from "../../../contracts/quarantine";
import { useQuarantineRecordSave } from "../../api/quarantine";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import { CommandBar } from "../../components/ui";
import { id, methodLabels, reportSections } from "./shared";
import { RecordAttachments } from "./RecordAttachments";
import { ReportInformation, ReportProjects, ReportSamples } from "./ReportFields";
import { ReportResults } from "./ReportResults";

function initialDraft(initial: QuarantineTest) {
  const draft = structuredClone(initial);
  if (!draft.updatedAt && draft.reportFormVersion === undefined) draft.reportFormVersion = 2;
  return draft;
}

export function TestEditor({
  initial,
  batch,
  detail,
  onCancel,
  onSaved,
}: {
  initial: QuarantineTest;
  batch: QuarantineBatch;
  detail: QuarantineDetail;
  onCancel: () => void;
  onSaved: (test: QuarantineTest) => void;
}) {
  const [draft, setDraft] = useState<QuarantineTest>(() => initialDraft(initial));
  const [baseline, setBaseline] = useState<QuarantineTest>(() => initialDraft(initial));
  const version = useRef(initial.updatedAt);
  const saving = useRef<Promise<QuarantineTest> | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [saved, setSaved] = useState(Boolean(initial.updatedAt));
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const [anchorOffset, setAnchorOffset] = useState(0);
  const getScrollContainer = useCallback(() => editorRef.current?.closest<HTMLElement>(".workspace") ?? window, []);
  useEffect(() => {
    const owner = getScrollContainer();
    const toolbar = editorRef.current?.querySelector<HTMLElement>(".app-command-bar");
    if (!(owner instanceof HTMLElement) || !toolbar) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setAnchorOffset(parseFloat(getComputedStyle(owner).getPropertyValue("--cl-workspace-toolbar-offset")) || 0);
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(owner);
    observer.observe(toolbar);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [getScrollContainer]);
  const [removal, setRemoval] = useState<{ kind: "sample" | "project"; id: string } | null>(null);
  const save = useQuarantineRecordSave();
  const sections = reportSections(draft.method);
  const [attachmentChanges, setAttachmentChanges] = useState<Record<string, boolean>>({});
  const attachmentDirty = Object.values(attachmentChanges).some(Boolean);
  const markAttachmentDirty = useCallback((id: string, changed: boolean) => {
    setAttachmentChanges((current) => (current[id] === changed ? current : { ...current, [id]: changed }));
  }, []);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [baseline, draft]);
  const confirmLeave = useUnsavedChanges(dirty || attachmentDirty, save.isPending || fileBusy);
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
    { key: "information", href: "#quarantine-part-1", title: "基础信息" },
    { key: "projects", href: "#quarantine-part-projects", title: "项目与试剂" },
    { key: "samples", href: `#quarantine-part-${sections.sample}`, title: "样本" },
    { key: "results", href: `#quarantine-part-${sections.results}`, title: "结果" },
    { key: "attachments", href: `#quarantine-part-${sections.pictures}`, title: "原始资料" },
  ];

  function changeDraft(test: QuarantineTest) {
    setDraft(test);
    setSaved(false);
  }

  function received(test: QuarantineTest) {
    version.current = test.updatedAt;
    setBaseline(structuredClone(test));
    setDraft(test);
    setSaved(true);
    onSaved(test);
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

  async function leave() {
    if (await confirmLeave()) onCancel();
  }

  function addSample() {
    const sample = {
      id: id(),
      number: String(draft.samples.length + 1),
      material: draft.reportMaterial || "",
      specimenState: draft.reportSpecimenState || "",
      poolCount: 1,
      portionCount: draft.reportFormVersion === 2 ? 0 : 1,
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

  return (
    <div className="quarantine-record-editor" ref={editorRef}>
      <CommandBar
        sticky
        ariaLabel="检测记录编辑操作"
        context={
          <>
            <Typography.Text strong>填写检测记录</Typography.Text>
            <Typography.Text type="secondary" aria-live="polite">
              {saved && !dirty && !attachmentDirty ? "当前内容已保存" : "内容尚未保存"}
            </Typography.Text>
          </>
        }
        actions={
          <Button disabled={save.isPending || fileBusy} onClick={() => void leave()}>
            返回批次
          </Button>
        }
        primaryAction={
          <Button
            aria-label="保存检测草稿"
            type="primary"
            disabled={fileBusy}
            loading={save.isPending}
            onClick={() => void finish()}
          >
            保存检测草稿
          </Button>
        }
      />
      <Form layout="vertical" disabled={save.isPending || fileBusy}>
        {error && <Alert type="error" title={error} showIcon />}
        <div className="quarantine-record-workspace">
          <aside className="quarantine-record-anchor" aria-label="检测记录章节">
            <Typography.Text type="secondary">所属检疫批次</Typography.Text>
            <Typography.Title level={4}>{batch.name}</Typography.Title>
            <Anchor
              items={outline}
              affix={false}
              getContainer={getScrollContainer}
              targetOffset={anchorOffset}
              onClick={(event) => event.preventDefault()}
            />
            <div className="quarantine-record-progress" aria-live="polite">
              <strong>
                {resultCompleted} / {resultTotal}
              </strong>
              <span>项判定已填写</span>
            </div>
          </aside>
          <div className="quarantine-record-content">
            <section className="quarantine-record-section" aria-label="基础信息">
              <Card title="基础信息" size="small">
                <Descriptions size="small" column={2} className="quarantine-record-summary">
                  <Descriptions.Item label="检测方法">{methodLabels[draft.method]}</Descriptions.Item>
                  <Descriptions.Item label="覆盖来源">{batch.sources.length} 个</Descriptions.Item>
                </Descriptions>
                <ReportInformation test={draft} onChange={changeDraft} hideTitle />
              </Card>
            </section>
            <section id="quarantine-part-projects" className="quarantine-record-section" aria-label="项目与试剂">
              <Card
                title="项目与试剂"
                size="small"
                extra={
                  <Button size="small" onClick={addProject}>
                    添加检测项目
                  </Button>
                }
              >
                <ReportProjects
                  test={draft}
                  batch={batch}
                  onChange={changeDraft}
                  onRemoveProject={(projectId) => setRemoval({ kind: "project", id: projectId })}
                />
                <Typography.Paragraph type="secondary" className="quarantine-record-hint">
                  项目名称、试剂盒和批号的修改不会清空已填写的结果。
                </Typography.Paragraph>
              </Card>
            </section>
            <section id={`quarantine-part-${sections.sample}`} className="quarantine-record-section" aria-label="样本">
              <Card
                title="样本"
                size="small"
                extra={
                  <Button size="small" onClick={addSample}>
                    添加样本
                  </Button>
                }
              >
                <ReportSamples
                  test={draft}
                  batch={batch}
                  onChange={changeDraft}
                  onRemoveSample={(sampleId) => setRemoval({ kind: "sample", id: sampleId })}
                />
              </Card>
            </section>
            <section className="quarantine-record-section" aria-label="检测结果">
              <Card title="检测结果" size="small">
                <ReportResults test={draft} onChange={changeDraft} sectionNumber={sections.results} hideTitle />
              </Card>
            </section>
            <section
              id={`quarantine-part-${sections.pictures}`}
              className="quarantine-record-section"
              aria-label="原始资料"
            >
              <Card title="原始资料" size="small">
                <RecordAttachments
                  test={draft}
                  attachments={detail.attachments}
                  persist={persist}
                  onVersion={received}
                  busy={save.isPending || fileBusy}
                  onBusy={setFileBusy}
                  onDirty={markAttachmentDirty}
                />
              </Card>
            </section>
          </div>
        </div>
      </Form>
      <Modal
        open={Boolean(removal)}
        title={removal?.kind === "sample" ? "删除此实验组？" : "删除此检测项目？"}
        onCancel={() => setRemoval(null)}
        onOk={remove}
        okText="确认删除"
      >
        <p>对应结果也会移除，其他实验组和项目的结果不变。如果已有图片关联，请先在原始资料中解除关联。</p>
      </Modal>
    </div>
  );
}
