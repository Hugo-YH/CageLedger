import { DatePicker } from "antd";
import dayjs from "dayjs";
import { useMemo } from "react";

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
  // A new Dayjs reference resets rc-picker's in-progress calendar value.
  // Feedback renders must not replace text that has not been submitted yet.
  const dateValue = useMemo(() => (value ? dayjs(value) : null), [value]);
  const maxDateValue = useMemo(() => (max ? dayjs(max) : undefined), [max]);
  return (
    <DatePicker
      id={id}
      aria-label={label}
      aria-required={required || undefined}
      allowClear={!required}
      picker={picker}
      format={format}
      value={dateValue}
      maxDate={maxDateValue}
      style={{ width: "100%" }}
      onChange={(date) => onChange(date?.format(format) || "")}
    />
  );
}
