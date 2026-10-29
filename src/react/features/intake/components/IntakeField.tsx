import { Form, Input } from "antd";
import { DateInput } from "../../../components/ui";
import { PersonNamesInput } from "../../../components/ui/PersonNamesInput";

export function IntakeField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  extra,
  personNames = false,
}: {
  personNames?: boolean;
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  extra?: string;
}) {
  return (
    <Form.Item label={label} required={required} extra={extra}>
      {type === "date" ? (
        <DateInput label={label} value={String(value)} onChange={onChange} required={required} />
      ) : personNames ? (
        <PersonNamesInput aria-label={label} value={String(value)} onChange={onChange} required={required} />
      ) : (
        <Input
          aria-label={label}
          type={type}
          value={value}
          min={type === "number" ? 0 : undefined}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Form.Item>
  );
}
