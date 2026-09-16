import { Input, Select, Table, Typography } from "antd";
import type { QuarantineProject, QuarantineTest } from "../../../contracts/quarantine";
import { reportResultOptions, resultLegend, resultSymbol } from "./shared";
export function ReportResults({
  test,
  onChange,
  sectionNumber,
  hideTitle = false,
}: {
  test: QuarantineTest;
  onChange?: (t: QuarantineTest) => void;
  sectionNumber: number;
  hideTitle?: boolean;
}) {
  const change = (project: QuarantineProject, patch: Partial<QuarantineProject>) =>
    onChange?.({ ...test, projects: test.projects.map((p) => (p.id === project.id ? { ...p, ...patch } : p)) });
  return (
    <section id={`quarantine-part-${sectionNumber}`} className="quarantine-report-section">
      {!hideTitle && <Typography.Title level={5}>检测结果</Typography.Title>}
      {test.projects.map((project, index) => {
        const samples = test.samples.filter((sample) => project.sampleIds.includes(sample.id));
        const controls = test.method === "parasite" ? [] : (["nc", "pc"] as const);
        return (
          <div key={project.id} className="quarantine-result-block">
            <Typography.Title level={5}>
              {index + 1}. {project.name}
            </Typography.Title>
            {onChange && test.method === "pcr" && (
              <Select
                mode="multiple"
                aria-label={`适用样本 ${index + 1}`}
                value={project.sampleIds}
                options={test.samples.map((s) => ({ value: s.id, label: s.number }))}
                onChange={(sampleIds) =>
                  change(project, {
                    sampleIds,
                    results: Object.fromEntries(
                      Object.entries(project.results).filter(([sid]) => sampleIds.includes(sid)),
                    ),
                  })
                }
              />
            )}
            <Table
              size="small"
              pagination={false}
              rowKey="id"
              scroll={{ x: test.method.startsWith("elisa") ? 520 : 360 }}
              dataSource={samples}
              columns={[
                { title: "样本编号", dataIndex: "number", width: 140 },
                {
                  title: "检测判定",
                  render: (_: unknown, sample: QuarantineTest["samples"][number]) => {
                    const value = project.results[sample.id] ?? "";
                    return onChange ? (
                      <Select
                        aria-label={`${project.name} ${sample.number} 判定`}
                        value={value}
                        options={
                          value === "not_tested"
                            ? [...reportResultOptions, { value: "not_tested", label: "未检测（旧记录）" }]
                            : reportResultOptions
                        }
                        onChange={(result) => change(project, { results: { ...project.results, [sample.id]: result } })}
                      />
                    ) : (
                      resultSymbol(value)
                    );
                  },
                },
                ...(test.method.startsWith("elisa")
                  ? [
                      {
                        title: "板孔号",
                        width: 180,
                        render: (_: unknown, sample: QuarantineTest["samples"][number]) =>
                          onChange ? (
                            <Input
                              aria-label={`${project.name} ${sample.number} 板孔号`}
                              value={project.wells[sample.id] ?? ""}
                              onChange={(event) =>
                                change(project, { wells: { ...project.wells, [sample.id]: event.target.value } })
                              }
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
                  return onChange ? (
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
                        onChange={(result) => change(project, { [control]: result })}
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
      })}
      <Typography.Paragraph>{resultLegend}</Typography.Paragraph>
    </section>
  );
}
