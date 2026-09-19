import { DatePicker } from "antd";
import dayjs from "dayjs";

/** Keep API date strings at the boundary while sharing Ant's calendar and locale. */
export function DateInput({
  label,
  value,
  onChange,
  id,
  max,
  required = false,
  picker = "date",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  max?: string;
  required?: boolean;
  picker?: "date" | "month";
}) {
  const format = picker === "month" ? "YYYY-MM" : "YYYY-MM-DD";
  return (
    <DatePicker
      id={id}
      aria-label={label}
      aria-required={required || undefined}
      allowClear={!required}
      picker={picker}
      format={format}
      value={value ? dayjs(value) : null}
      maxDate={max ? dayjs(max) : undefined}
      style={{ width: "100%" }}
      onChange={(date) => onChange(date?.format(format) || "")}
    />
  );
}
