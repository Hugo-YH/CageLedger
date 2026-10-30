import { memo, type RefObject } from "react";
import { Button, Space, Tag } from "antd";
import { formatPersonNames } from "../../../domain/personNames";
import type { TechnicalServiceListItem } from "../../../contracts/technicalServices";
import type { ServiceListParams } from "../../api/technicalServices";
import { DataTable } from "../../components/ui";
import type { ListDensity } from "../../components/ui/ListViewControls";
import { ServiceColumnTitle } from "./ServiceColumnTitle";

export const SavedServicesTable = memo(function SavedServicesTable({
  items,
  params,
  density,
  blocked,
  fetching,
  pending,
  highlightedRowId,
  reducedMotion,
  editButtonRefs,
  onClearHighlight,
  onFilter,
  onSort,
  onView,
  onEdit,
  onDelete,
}: {
  items: TechnicalServiceListItem[];
  params: ServiceListParams;
  density: ListDensity;
  blocked: boolean;
  fetching: boolean;
  pending: boolean;
  highlightedRowId: string | null;
  reducedMotion: boolean;
  editButtonRefs: RefObject<Map<string, HTMLElement>>;
  onClearHighlight: (value: null) => void;
  onFilter: (column: string, values: string[]) => void;
  onSort: (column: string) => void;
  onView: (sheet: TechnicalServiceListItem) => void;
  onEdit: (sheet: TechnicalServiceListItem) => void;
  onDelete: (sheet: TechnicalServiceListItem) => void;
}) {
  function title(column: string, label: string) {
    return (
      <ServiceColumnTitle
        list="sheets"
        params={params}
        column={column}
        label={label}
        onFilter={(values) => onFilter(column, values)}
        onSort={() => onSort(column)}
      />
    );
  }
  return (
    <DataTable<TechnicalServiceListItem>
      resizeKey="technical-service-saved"
      refreshing={fetching}
      rowKey="id"
      loading={pending}
      dataSource={items}
      scroll={{ x: 1200 }}
      pagination={false}
      size={density}
      onRow={(row) =>
        row.id === highlightedRowId && !reducedMotion
          ? {
              className: "technical-service-row-saved",
              onAnimationEnd: (event) => {
                if (event.animationName === "technical-service-row-saved") onClearHighlight(null);
              },
            }
          : {}
      }
      columns={[
        { title: title("month", "月份"), dataIndex: "month", width: 110 },
        { title: title("iacuc", "IACUC"), dataIndex: "iacuc", width: 150 },
        {
          title: title("pi", "项目负责人"),
          dataIndex: "pi",
          width: 160,
          render: (value: string) => formatPersonNames(value),
        },
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
          render: (_, row) => (
            <Tag color={row.protected ? "processing" : "default"}>{row.protected ? "已发起结算" : "可编辑"}</Tag>
          ),
        },
        {
          title: "操作",
          key: "actions",
          width: 240,
          fixed: "right",
          render: (_, row) => (
            <Space size={8} className="technical-service-row-actions" aria-label={`${row.iacuc}操作`}>
              <Button color="blue" variant="filled" disabled={blocked || fetching} onClick={() => onView(row)}>
                预览
              </Button>
              <Button
                ref={(node) => {
                  if (node) editButtonRefs.current.set(row.id, node);
                  else editButtonRefs.current.delete(row.id);
                }}
                type="primary"
                disabled={blocked || fetching}
                onClick={() => onEdit(row)}
              >
                编辑
              </Button>
              <Button danger disabled={row.protected || blocked || fetching} onClick={() => onDelete(row)}>
                删除
              </Button>
            </Space>
          ),
        },
      ]}
    />
  );
});
