import { Button, DatePicker, Form, Input, Select, Space, Table, Typography } from "antd";
import dayjs from "dayjs";
import type { QuarantineBatch, QuarantineProject, QuarantineTest } from "../../../contracts/quarantine";

type Props = {
  test: QuarantineTest;
  batch: QuarantineBatch;
  onChange?: (test: QuarantineTest) => void;
  onRemoveSample?: (id: string) => void;
  onRemoveProject?: (id: string) => void;
  fields?: ("name" | "kit" | "lot")[];
};

function sourceLabel(source: QuarantineBatch["sources"][number]) {
  if (source.pi && source.owner) return `${source.pi}${source.pi.endsWith("组") ? "" : "组"}${source.owner}`;
  return source.pi || source.owner || source.notes || "手工来源";
}

export function ReportInformation({
  test,
  onChange,
  hideTitle = false,
}: Pick<Props, "test" | "onChange"> & { hideTitle?: boolean }) {
  const material = test.reportMaterial ?? [...new Set(test.samples.map((s) => s.material))].join("、");
  const state =
    test.reportSpecimenState ?? [...new Set(test.samples.map((s) => s.specimenState))].filter(Boolean).join("、");
  const pools = test.reportFormVersion === 2 ? test.samples.length : test.samples.reduce((n, s) => n + s.poolCount, 0);
  const portions = test.samples.reduce(
    (n, s) => n + (test.reportFormVersion === 2 ? new Set(s.sourceIds).size : s.portionCount),
    0,
  );
  return (
    <section id="quarantine-part-1" className="quarantine-report-section">
      {!hideTitle && <Typography.Title level={5}>采样与实验信息</Typography.Title>}
      <div className="quarantine-fields quarantine-report-metadata">
        {(
          [
            ["samplingDate", "采样日期"],
            ["testDate", "实验日期"],
          ] as const
        ).map(([key, label]) => (
          <Form.Item label={label} key={key}>
            {onChange ? (
              <DatePicker
                aria-label={label}
                value={test[key] ? dayjs(test[key]) : null}
                onChange={(v) => onChange({ ...test, [key]: v?.format("YYYY-MM-DD") ?? "" })}
              />
            ) : (
              test[key] || "/"
            )}
          </Form.Item>
        ))}
        <Form.Item label="样品名称">
          {onChange ? (
            <Input
              aria-label="样品名称"
              value={material}
              onChange={(e) =>
                onChange({
                  ...test,
                  reportMaterial: e.target.value,
                  samples: test.samples.map((s) => ({ ...s, material: e.target.value })),
                })
              }
            />
          ) : (
            material || "/"
          )}
        </Form.Item>
        <Form.Item label="样品状态">
          {onChange ? (
            <Input
              aria-label="样品状态"
              value={state}
              onChange={(e) =>
                onChange({
                  ...test,
                  reportSpecimenState: e.target.value,
                  samples: test.samples.map((s) => ({ ...s, specimenState: e.target.value })),
                })
              }
            />
          ) : (
            state || "/"
          )}
        </Form.Item>
      </div>
      <p aria-live="polite">
        样品数量：
        <strong>
          {pools}样（{portions}份{material}）
        </strong>
      </p>
    </section>
  );
}
export function ReportProjects({ test, onChange, onRemoveProject, fields }: Props) {
  const parasite = test.method === "parasite";
  const change = (project: QuarantineProject, key: "name" | "kit" | "lot", value: string) =>
    onChange?.({ ...test, projects: test.projects.map((p) => (p.id === project.id ? { ...p, [key]: value } : p)) });
  return (
    <Table<QuarantineProject>
      size="small"
      rowKey="id"
      pagination={false}
      scroll={{ x: parasite ? 360 : 720 }}
      dataSource={test.projects}
      columns={[
        ...(
          [
            ["name", "检测项目"],
            ...(!parasite
              ? [
                  ["kit", "试剂盒名称"],
                  ["lot", "批号"],
                ]
              : []),
          ] as ["name" | "kit" | "lot", string][]
        )
          .filter(([key]) => !fields || fields.includes(key))
          .map(([key, label]) => ({
            title: label,
            render: (_: unknown, p: QuarantineProject, i: number) =>
              onChange ? (
                <Input
                  aria-label={`${label} ${i + 1}`}
                  value={p[key]}
                  onChange={(e) => change(p, key, e.target.value)}
                />
              ) : (
                p[key] || "/"
              ),
          })),
        ...(onRemoveProject
          ? [
              {
                title: "操作",
                width: 80,
                render: (_: unknown, p: QuarantineProject) => (
                  <Button danger type="text" onClick={() => onRemoveProject(p.id)}>
                    删除项目
                  </Button>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
export function ReportSamples({ test, batch, onChange, onRemoveSample }: Props) {
  const sourceMap = new Map(batch.sources.map((source) => [source.id, source]));
  const assigned = new Set(test.samples.flatMap((sample) => sample.sourceIds));
  const sourceOptions = batch.sources
    .filter(
      (source) =>
        !test.method.startsWith("elisa") ||
        (test.method === "elisa_mouse" ? ["小鼠", "mouse"] : ["大鼠", "rat"]).includes(source.species.toLowerCase()),
    )
    .map((source) => ({ value: source.id, label: sourceLabel(source) }));
  return (
    <>
      <Table
        className="quarantine-sample-table"
        rowKey="id"
        size="small"
        pagination={false}
        scroll={{ x: onRemoveSample ? 980 : 900 }}
        dataSource={test.samples}
        columns={[
          {
            title: "实验组",
            width: 90,
            render: (_: unknown, _sample: QuarantineTest["samples"][number], index: number) => `实验组 ${index + 1}`,
          },
          {
            title: "样本编号",
            width: 130,
            render: (_: unknown, sample: QuarantineTest["samples"][number], index: number) =>
              onChange ? (
                <Input
                  aria-label={`样本编号 ${index + 1}`}
                  value={sample.number}
                  onChange={(event) =>
                    onChange({
                      ...test,
                      samples: test.samples.map((item) =>
                        item.id === sample.id ? { ...item, number: event.target.value } : item,
                      ),
                    })
                  }
                />
              ) : (
                sample.number || "/"
              ),
          },
          {
            title: "混样来源",
            width: 280,
            render: (_: unknown, sample: QuarantineTest["samples"][number], index: number) => {
              const ownIds = new Set(sample.sourceIds);
              const selected = sample.sourceIds.flatMap((id) => {
                const source = sourceMap.get(id);
                return source ? [source] : [];
              });
              const options = sourceOptions.filter((option) => ownIds.has(option.value) || !assigned.has(option.value));
              return onChange ? (
                <Select
                  mode="multiple"
                  aria-label={`混样来源 ${index + 1}`}
                  value={sample.sourceIds}
                  options={options}
                  onChange={(sourceIds) =>
                    onChange({
                      ...test,
                      samples: test.samples.map((item) =>
                        item.id === sample.id
                          ? { ...item, sourceIds, poolCount: 1, portionCount: new Set(sourceIds).size }
                          : item,
                      ),
                    })
                  }
                />
              ) : (
                <Space orientation="vertical">
                  {selected.map((source) => (
                    <span key={source.id}>{sourceLabel(source)}</span>
                  ))}
                </Space>
              );
            },
          },
          {
            title: "供应商",
            width: 150,
            render: (_: unknown, sample: QuarantineTest["samples"][number]) =>
              [
                ...new Set(sample.sourceIds.flatMap((id) => (sourceMap.get(id) ? [sourceMap.get(id)!.supplier] : []))),
              ].join("、") || "—",
          },
          {
            title: "材料",
            width: 160,
            render: (_: unknown, sample: QuarantineTest["samples"][number], index: number) =>
              onChange ? (
                <Input
                  aria-label={`材料 ${index + 1}`}
                  value={sample.material}
                  onChange={(event) =>
                    onChange({
                      ...test,
                      samples: test.samples.map((item) =>
                        item.id === sample.id ? { ...item, material: event.target.value } : item,
                      ),
                    })
                  }
                />
              ) : (
                sample.material || "/"
              ),
          },
          ...(onRemoveSample
            ? [
                {
                  title: "操作",
                  width: 96,
                  render: (_: unknown, sample: QuarantineTest["samples"][number]) => (
                    <Button danger type="text" onClick={() => onRemoveSample(sample.id)}>
                      删除样本
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
      {onChange && (
        <Typography.Paragraph type="secondary">
          每个编号代表一个实验组，每选一个来源计一份原始样本。通常同供应商混样；未直接采样的动物仍属于整批检疫覆盖范围。
        </Typography.Paragraph>
      )}
    </>
  );
}
