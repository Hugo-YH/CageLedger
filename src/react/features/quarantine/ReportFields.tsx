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
export function ReportInformation({ test, onChange }: Pick<Props, "test" | "onChange">) {
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
      <Typography.Title level={5}>1、采样实验信息</Typography.Title>
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
  const rows = [
    "样本编号",
    "供应商",
    "课题组／实验人员",
    ...(test.method === "pcr" ? ["材料"] : []),
    ...(onRemoveSample ? ["操作"] : []),
  ];
  return (
    <>
      <Table
        className="quarantine-sample-table"
        rowKey="label"
        size="small"
        showHeader={false}
        pagination={false}
        scroll={{ x: Math.max(500, 130 + test.samples.length * 220) }}
        dataSource={rows.map((label) => ({ label }))}
        columns={[
          { title: "样本统计", dataIndex: "label", width: 130 },
          ...test.samples.map((sample, index) => ({
            title: `实验组 ${index + 1}`,
            key: sample.id,
            width: 220,
            render: (_: unknown, row: { label: string }) => {
              const selected = batch.sources.filter((s) => sample.sourceIds.includes(s.id));
              if (row.label === "供应商")
                return [...new Set(selected.map((s) => s.supplier))].join("、") || "选择来源后带入";
              if (row.label === "课题组／实验人员")
                return onChange ? (
                  <Select
                    mode="multiple"
                    aria-label={`混样来源 ${index + 1}`}
                    value={sample.sourceIds}
                    options={batch.sources
                      .filter(
                        (s) =>
                          !test.method.startsWith("elisa") ||
                          (test.method === "elisa_mouse" ? ["小鼠", "mouse"] : ["大鼠", "rat"]).includes(
                            s.species.toLowerCase(),
                          ),
                      )
                      .map((s) => ({
                        value: s.id,
                        label: [s.pi, s.owner].filter(Boolean).join("／") || s.notes || "手工来源",
                      }))}
                    onChange={(sourceIds) =>
                      onChange({
                        ...test,
                        samples: test.samples.map((s) =>
                          s.id === sample.id
                            ? { ...s, sourceIds, poolCount: 1, portionCount: new Set(sourceIds).size }
                            : s,
                        ),
                      })
                    }
                  />
                ) : (
                  <Space orientation="vertical">
                    {selected.map((s) => (
                      <span key={s.id}>{[s.pi, s.owner].filter(Boolean).join("／") || s.notes || "手工来源"}</span>
                    ))}
                  </Space>
                );
              if (row.label === "操作")
                return (
                  <Button danger type="text" onClick={() => onRemoveSample?.(sample.id)}>
                    删除样本
                  </Button>
                );
              const key = row.label === "材料" ? "material" : "number";
              return onChange ? (
                <Input
                  aria-label={`${row.label} ${index + 1}`}
                  value={sample[key]}
                  onChange={(e) =>
                    onChange({
                      ...test,
                      samples: test.samples.map((s) => (s.id === sample.id ? { ...s, [key]: e.target.value } : s)),
                    })
                  }
                />
              ) : (
                sample[key]
              );
            },
          })),
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
