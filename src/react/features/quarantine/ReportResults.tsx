import { Collapse, Input, Select, Table, Typography } from "antd";
import type { QuarantineProject, QuarantineTest } from "../../../contracts/quarantine";
import { reportResultOptions, resultLegend, resultSymbol } from "./shared";
export function ReportResults({
  test,
  onChange,
  sectionNumber,
}: {
  test: QuarantineTest;
  onChange?: (t: QuarantineTest) => void;
  sectionNumber: number;
}) {
  const change = (project: QuarantineProject, patch: Partial<QuarantineProject>) =>
    onChange?.({ ...test, projects: test.projects.map((p) => (p.id === project.id ? { ...p, ...patch } : p)) });
  return (
    <section id={`quarantine-part-${sectionNumber}`} className="quarantine-report-section">
      <Typography.Title level={5}>{sectionNumber}、实验结果统计表</Typography.Title>
      {test.projects.map((project, index) => {
        const columns = [
          ...test.samples.map((s) => ({ id: s.id, label: s.number })),
          ...(test.method === "parasite"
            ? []
            : [
                { id: "nc", label: "NC" },
                { id: "pc", label: "PC" },
              ]),
        ];
        return (
          <div key={project.id} className="quarantine-result-block">
            <Typography.Title level={5}>
              {sectionNumber}-{index + 1} {project.name}
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
              rowKey="label"
              scroll={{ x: Math.max(520, 120 + columns.length * 120) }}
              dataSource={[{ label: "检测结果" }]}
              columns={[
                { title: "样本编号", dataIndex: "label", width: 120 },
                ...columns.map(({ id, label }) => ({
                  title: label,
                  key: id,
                  width: 120,
                  render: () => {
                    const control = id === "nc" || id === "pc";
                    const applicable = control || project.sampleIds.includes(id);
                    const value = control ? project[id] : (project.results[id] ?? "");
                    if (!applicable) return <span title="此项目不适用于该样本">/</span>;
                    return onChange ? (
                      <Select
                        aria-label={`${project.name} ${label} 判定`}
                        value={value}
                        options={
                          value === "not_tested"
                            ? [...reportResultOptions, { value: "not_tested", label: "未检测（旧记录）" }]
                            : reportResultOptions
                        }
                        onChange={(v) =>
                          change(project, control ? { [id]: v } : { results: { ...project.results, [id]: v } })
                        }
                      />
                    ) : (
                      resultSymbol(value)
                    );
                  },
                })),
              ]}
            />
            {onChange && test.method.startsWith("elisa") && (
              <Collapse
                ghost
                items={[
                  {
                    key: "wells",
                    label: "板孔号（如需记录）",
                    children: (
                      <div className="quarantine-fields">
                        {columns.map(({ id, label }) => (
                          <label key={id}>
                            {label}
                            <Input
                              aria-label={`${project.name} ${label} 板孔号`}
                              value={project.wells[id] ?? ""}
                              onChange={(e) => change(project, { wells: { ...project.wells, [id]: e.target.value } })}
                            />
                          </label>
                        ))}
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </div>
        );
      })}
      <Typography.Paragraph>{resultLegend}</Typography.Paragraph>
    </section>
  );
}
