import { ServiceColumnTitle } from "./ServiceColumnTitle";
import { useState } from "react";
import { Alert, Button, Modal, Space, Tag } from "antd";

import type { TechnicalServiceSheet } from "../../../contracts/technicalServices";
import { useServiceList, useServiceMutation } from "../../api/technicalServices";
import { useNavigationGuard } from "../../state/ui";
import { ServiceEditor } from "./ServiceEditor";
import { ServiceDetails } from "./ServiceDetails";
import { DataTable } from "../../components/ui";
import { PageSkeleton, Pager } from "../../components/WorkspaceUi";

export function SavedServices() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [viewing, setViewing] = useState<TechnicalServiceSheet | null>(null);
  const [editing, setEditing] = useState<TechnicalServiceSheet | null>(null);
  const [deleting, setDeleting] = useState<TechnicalServiceSheet | null>(null);
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "month", dir: "desc" });
  const params = {
    columnFilters: filters,
    sortKey: sort.key,
    sortDir: sort.dir,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
  function title(column: string, label: string) {
    return (
      <ServiceColumnTitle
        list="sheets"
        params={params}
        column={column}
        label={label}
        onFilter={(values) => {
          setFilters((previous) => ({ ...previous, [column]: values }));
          setPage(1);
        }}
        onSort={() => {
          setSort((previous) => ({
            key: column,
            dir: previous.key === column && previous.dir === "asc" ? "desc" : "asc",
          }));
          setPage(1);
        }}
      />
    );
  }
  const query = useServiceList(params);
  const mutation = useServiceMutation();
  const guard = useNavigationGuard();
  async function closeEditor() {
    if (await (guard.current?.() ?? Promise.resolve(true))) setEditing(null);
  }
  async function remove() {
    if (!deleting) return;
    try {
      await mutation.mutateAsync({ kind: "delete", sheet: deleting });
      setDeleting(null);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除失败");
    }
  }
  return (
    <section className="panel technical-service-list-panel">
      {query.isError || notice ? (
        <Alert
          showIcon
          type="error"
          title={notice || "明细列表读取失败"}
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      ) : null}
      {query.isPending ? (
        <PageSkeleton label="技术服务明细" variant="table" embedded />
      ) : (
        <div
          className="technical-service-table-region"
          role="region"
          tabIndex={0}
          aria-label="已保存技术服务明细列表"
          aria-busy={query.isFetching}
        >
          <DataTable<TechnicalServiceSheet>
            resizeKey="technical-service-saved"
            refreshing={query.isFetching}
            rowKey="id"
            loading={query.isPending || mutation.isPending}
            dataSource={query.data?.items}
            scroll={{ x: 1200 }}
            pagination={false}
            columns={[
              { title: title("month", "月份"), dataIndex: "month", width: 110 },
              { title: title("iacuc", "IACUC"), dataIndex: "iacuc", width: 150 },
              { title: title("pi", "项目负责人"), dataIndex: "pi", width: 160 },
              {
                title: title("facility", "服务设施"),
                width: 130,
                key: "facility",
                render: (_, row) => (row.facility === "zhujiang" ? "珠江新城" : "生物岛"),
              },
              { title: title("serviceName", "服务项目"), dataIndex: "serviceName", width: 180 },
              { title: title("serviceDayCount", "服务日数"), dataIndex: "serviceDayCount", width: 130 },
              {
                title: title("quantity", "计费数量"),
                width: 130,
                key: "quantity",
                render: (_, row) => `${row.totalQuantity} ${row.unit}`,
              },
              {
                title: title("amount", "金额（元）"),
                width: 150,
                key: "amount",
                align: "right",
                render: (_, row) => row.totalAmount.toFixed(2),
              },
              {
                title: title("status", "状态"),
                width: 130,
                key: "status",
                render: (_, row) => <Tag>{row.protected ? "已发起结算" : "可编辑"}</Tag>,
              },
              {
                title: "操作",
                key: "actions",
                width: 240,
                fixed: "right",
                render: (_, row) => (
                  <Space size={8} className="technical-service-row-actions" aria-label={`${row.iacuc}操作`}>
                    <Button color="blue" variant="filled" disabled={query.isFetching} onClick={() => setViewing(row)}>
                      预览
                    </Button>
                    <Button type="primary" disabled={query.isFetching} onClick={() => setEditing(row)}>
                      编辑
                    </Button>
                    <Button danger disabled={row.protected || query.isFetching} onClick={() => setDeleting(row)}>
                      删除
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      )}
      <Pager
        page={page}
        pageSize={pageSize}
        pages={Math.ceil((query.data?.page.total || 0) / pageSize)}
        total={query.data?.page.total || 0}
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
      <Modal
        open={Boolean(viewing)}
        title="技术服务明细预览"
        rootClassName="app-modal-root technical-service-modal"
        width={1000}
        onCancel={() => setViewing(null)}
        footer={<Button onClick={() => setViewing(null)}>关闭</Button>}
      >
        {viewing ? <ServiceDetails sheet={viewing} /> : null}
      </Modal>
      <Modal
        open={Boolean(editing)}
        title="技术服务明细"
        rootClassName="app-modal-root technical-service-modal"
        width={1000}
        footer={null}
        destroyOnHidden
        onCancel={() => void closeEditor()}
      >
        {editing ? (
          <ServiceEditor
            key={editing.id}
            initial={editing}
            onSaved={() => setEditing(null)}
            onCancel={() => void closeEditor()}
          />
        ) : null}
      </Modal>
      <Modal
        open={Boolean(deleting)}
        title="删除技术服务明细"
        rootClassName="app-modal-root technical-service-modal"
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: mutation.isPending }}
        onOk={() => void remove()}
        onCancel={() => setDeleting(null)}
      >
        删除后该明细不再参与结算。{deleting?.serviceName}
        {notice ? <Alert type="error" title={notice} /> : null}
      </Modal>
    </section>
  );
}
