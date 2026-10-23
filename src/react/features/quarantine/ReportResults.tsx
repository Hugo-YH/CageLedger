import { memo, useCallback, useMemo } from "react";
import { Input, Select, Table, Typography } from "antd";
import type { QuarantineProject, QuarantineSample, QuarantineTest } from "../../../contracts/quarantine";
import { reportResultOptions, resultLegend, resultSymbol } from "./shared";

type ProjectUpdate = (current: QuarantineProject) => QuarantineProject;
type ProjectChange = (projectId: string, update: ProjectUpdate) => void;

export function ReportResults({
  test,
  onChange,
  onProjectChange,
  sectionNumber,
  hideTitle = false,
}: {
  test: QuarantineTest;
  onChange?: (t: QuarantineTest) => void;
  onProjectChange?: ProjectChange;
  sectionNumber: number;
  hideTitle?: boolean;
}) {
  const changeWholeTest = useCallback(
    (projectId: string, update: ProjectUpdate) => {
      onChange?.({
        ...test,
        projects: test.projects.map((project) => (project.id === projectId ? update(project) : project)),
      });
    },
    [onChange, test],
  );
  const change = onProjectChange ?? (onChange ? changeWholeTest : undefined);
  const sampleOptions = useMemo(
    () => test.samples.map((sample) => ({ value: sample.id, label: sample.number })),
    [test.samples],
  );
  return (
    <section id={`quarantine-part-${sectionNumber}`} className="quarantine-report-section">
      {!hideTitle && <Typography.Title level={5}>检测结果</Typography.Title>}
      {test.projects.map((project, index) => (
        <ReportResultProject
          key={project.id}
          project={project}
          index={index}
          method={test.method}
          allSamples={test.samples}
          sampleOptions={sampleOptions}
          onProjectChange={change}
        />
      ))}
      <Typography.Paragraph>{resultLegend}</Typography.Paragraph>
    </section>
  );
}

const ReportResultProject = memo(function ReportResultProject({
  project,
  index,
  method,
  allSamples,
  sampleOptions,
  onProjectChange,
}: {
  project: QuarantineProject;
  index: number;
  method: QuarantineTest["method"];
  allSamples: QuarantineSample[];
  sampleOptions: Array<{ value: string; label: string }>;
  onProjectChange?: ProjectChange;
}) {
  const samples = useMemo(() => {
    const ids = new Set(project.sampleIds);
    return allSamples.filter((sample) => ids.has(sample.id));
  }, [allSamples, project.sampleIds]);
  const controls = method === "parasite" ? [] : (["nc", "pc"] as const);
  const change = (update: ProjectUpdate) => onProjectChange?.(project.id, update);
  return (
    <div key={project.id} className="quarantine-result-block">
      <Typography.Title level={5}>
        {index + 1}. {project.name}
      </Typography.Title>
      {onProjectChange && method === "pcr" && (
        <Select
          mode="multiple"
          aria-label={`适用样本 ${index + 1}`}
          value={project.sampleIds}
          options={sampleOptions}
          onChange={(sampleIds) =>
            change((current) => ({
              ...current,
              sampleIds,
              results: Object.fromEntries(Object.entries(current.results).filter(([sid]) => sampleIds.includes(sid))),
            }))
          }
        />
      )}
      <Table
        size="small"
        pagination={false}
        rowKey="id"
        scroll={{ x: method.startsWith("elisa") ? 520 : 360 }}
        dataSource={samples}
        columns={[
          { title: "样本编号", dataIndex: "number", width: 140 },
          {
            title: "检测判定",
            render: (_: unknown, sample: QuarantineTest["samples"][number]) => {
              const value = project.results[sample.id] ?? "";
              return onProjectChange ? (
                <Select
                  aria-label={`${project.name} ${sample.number} 判定`}
                  value={value}
                  options={
                    value === "not_tested"
                      ? [...reportResultOptions, { value: "not_tested", label: "未检测（旧记录）" }]
                      : reportResultOptions
                  }
                  onChange={(result) =>
                    change((current) => ({ ...current, results: { ...current.results, [sample.id]: result } }))
                  }
                />
              ) : (
                resultSymbol(value)
              );
            },
          },
          ...(method.startsWith("elisa")
            ? [
                {
                  title: "板孔号",
                  width: 180,
                  render: (_: unknown, sample: QuarantineTest["samples"][number]) =>
                    onProjectChange ? (
                      <Input
                        aria-label={`${project.name} ${sample.number} 板孔号`}
                        value={project.wells[sample.id] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          change((current) => ({ ...current, wells: { ...current.wells, [sample.id]: value } }));
                        }}
                      />
                    ) : (
                      project.wells[sample.id] || "/"
                    ),
                },
              ]
            : []),
        ]}
      />
      {controls.length > 0 && (
        <div className="quarantine-result-controls" aria-label={`${project.name} 对照判定`}>
          {controls.map((control) => {
            const label = control.toUpperCase();
            const value = project[control];
            return onProjectChange ? (
              <label key={control}>
                {label}
                <Select
                  aria-label={`${project.name} ${label} 判定`}
                  value={value}
                  options={
                    value === "not_tested"
                      ? [...reportResultOptions, { value: "not_tested", label: "未检测（旧记录）" }]
                      : reportResultOptions
                  }
                  onChange={(result) => change((current) => ({ ...current, [control]: result }))}
                />
              </label>
            ) : (
              <span key={control}>
                {label}：{resultSymbol(value)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
});
