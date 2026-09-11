import { useState } from "react";
import { Alert, Button, DatePicker, Select, Space, Table, Tag } from "antd";
import dayjs from "dayjs";
import type { IntakeBatch } from "../../../contracts/intake";
import type { QuarantineSource } from "../../../contracts/quarantine";
import { useQuarantineSources } from "../../api/quarantine";
import { id } from "./shared";

export function QuarantinePool({
  onCreate,
  onOpen,
}: {
  onCreate: (sources: QuarantineSource[]) => void;
  onOpen: (id: string) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [state, setState] = useState("pending");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<IntakeBatch[]>([]);
  const query = useQuarantineSources(from, to, page, true, state);
  return (
    <>
      <Alert
        type="info"
        showIcon
        title="接收后自动进入待检疫池。勾选本次覆盖的动物建立检疫批次，再从中登记实际抽样；确认完成后，未直接采样的覆盖动物也统一标记已检疫。"
      />
      <Space wrap>
        <Select
          aria-label="检疫池范围"
          value={state}
          options={[
            { value: "pending", label: "待检疫" },
            { value: "all", label: "全部已接收动物" },
          ]}
          onChange={(v) => {
            setState(v);
            setPage(1);
            setSelected([]);
          }}
        />
        <DatePicker
          aria-label="检疫池接收起始日期"
          value={from ? dayjs(from) : null}
          onChange={(v) => {
            setFrom(v?.format("YYYY-MM-DD") ?? "");
            setPage(1);
          }}
        />
        <DatePicker
          aria-label="检疫池接收结束日期"
          value={to ? dayjs(to) : null}
          onChange={(v) => {
            setTo(v?.format("YYYY-MM-DD") ?? "");
            setPage(1);
          }}
        />
        <Button
          type="primary"
          disabled={!selected.length}
          onClick={() => onCreate(selected.map((s) => ({ ...s, id: id(), intakeId: s.id })))}
        >
          用所选动物新建检疫批次（{selected.length}）
        </Button>
      </Space>
      {query.error && <Alert type="error" title={query.error.message} />}
      <Table<IntakeBatch>
        rowKey="id"
        size="small"
        loading={query.isLoading}
        dataSource={query.data?.items ?? []}
        scroll={{ x: 900 }}
        rowSelection={{
          selectedRowKeys: selected.map((s) => s.id),
          preserveSelectedRowKeys: true,
          onChange: (_, rows) => setSelected(rows),
          getCheckboxProps: (s) => ({ disabled: s.quarantineStatus !== "待检疫" }),
        }}
        pagination={{
          current: page,
          pageSize: 30,
          total: query.data?.page.total,
          showSizeChanger: false,
          onChange: setPage,
        }}
        columns={[
          { title: "接收日期", dataIndex: "intakeDate" },
          { title: "到货批次", dataIndex: "batchNo" },
          { title: "供应商", dataIndex: "supplier" },
          { title: "品系", render: (_, s) => s.strainStandard || s.strainRaw || "—" },
          { title: "种类", dataIndex: "species" },
          { title: "数量", dataIndex: "quantity" },
          { title: "课题组", dataIndex: "pi" },
          { title: "检疫状态", render: (_, s) => <Tag>{s.quarantineStatus}</Tag> },
          {
            title: "关联检疫批次",
            render: (_, s) => (
              <Space wrap>
                {s.quarantineBatches?.map((b) => (
                  <Button key={b.id} onClick={() => onOpen(b.id)}>
                    {b.name}
                  </Button>
                ))}
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}
