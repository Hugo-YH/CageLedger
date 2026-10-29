import { formatPersonNames } from "../../../domain/personNames";
import { Descriptions, Typography } from "antd";

import type { TechnicalServiceSheet } from "../../../contracts/technicalServices";
import { technicalServiceAmount } from "../../../domain/technicalServiceMoney";
import { DataTable } from "../../components/ui";
import { ServiceTotals } from "./ServiceTotals";

export function ServiceDetails({ sheet }: { sheet: TechnicalServiceSheet }) {
  return (
    <div className="technical-service-details">
      <Descriptions
        column={{ xs: 1, sm: 2 }}
        items={[
          { key: "month", label: "月份", children: sheet.month },
          { key: "facility", label: "服务设施", children: sheet.facility === "zhujiang" ? "珠江新城" : "生物岛" },
          { key: "iacuc", label: "IACUC", children: sheet.iacuc },
          { key: "project", label: "科研项目", children: sheet.project },
          { key: "pi", label: "项目负责人", children: formatPersonNames(sheet.pi) },
          { key: "funding", label: "项目来源", children: sheet.funding || "—" },
          { key: "service", label: "服务项目", children: sheet.serviceName },
          {
            key: "price",
            label: "收费标准",
            children: `${sheet.unitPrice.toFixed(2)} 元／${sheet.unit}（${sheet.customerType === "internal" ? "院内" : "院外"}）`,
          },
        ]}
      />
      <DataTable
        rowKey="date"
        pagination={false}
        dataSource={sheet.rows}
        resizeKey="technical-service-details"
        columns={[
          { title: "服务日期", dataIndex: "date" },
          { title: `计费数量（${sheet.unit}）`, dataIndex: "quantity" },
          {
            title: "金额（元）",
            key: "amount",
            align: "right",
            render: (_, row) => technicalServiceAmount(row.quantity, sheet.unitPrice).toFixed(2),
          },
        ]}
      />
      <ServiceTotals
        days={sheet.serviceDayCount}
        quantity={sheet.totalQuantity}
        unit={sheet.unit}
        amount={sheet.totalAmount}
      />
      {sheet.notes ? <Typography.Paragraph>备注：{sheet.notes}</Typography.Paragraph> : null}
    </div>
  );
}
