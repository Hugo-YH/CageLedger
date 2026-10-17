import { Typography } from "antd";

/** Display the existing calculation without deriving prices or quantities. */
export function ServiceTotals({
  days,
  quantity,
  unit,
  amount,
}: {
  days: number;
  quantity: number;
  unit: string;
  amount: number;
}) {
  return (
    <section className="technical-service-totals" aria-label="技术服务费用核对">
      {[
        { key: "days", label: "服务日数", value: days, unit: "个服务日" },
        { key: "quantity", label: "累计数量", value: quantity, unit },
        { key: "amount", label: "技术服务费", value: amount.toFixed(2), unit: "元" },
      ].map((item) => (
        <div key={item.key} className="technical-service-total" data-total={item.key}>
          <Typography.Text type="secondary">{item.label}</Typography.Text>
          <div className="technical-service-total-value">
            <Typography.Text strong>{item.value}</Typography.Text>
            <Typography.Text>{item.unit}</Typography.Text>
          </div>
        </div>
      ))}
    </section>
  );
}
