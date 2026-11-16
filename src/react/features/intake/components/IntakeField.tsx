import { Form, Input } from "antd";
import { DateInput } from "../../../components/ui";
import { PersonNamesInput } from "../../../components/ui/PersonNamesInput";
import { useId } from "react";

export function IntakeField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  extra,
  tooltip,
  personNames = false,
  error,
}: {
  personNames?: boolean;
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  extra?: string;
  tooltip?: string;
  error?: string;
}) {
  const errorId = useId();
  return (
    <Form.Item
      label={label}
      required={required}
      extra={extra}
      tooltip={tooltip}
      validateStatus={error ? "error" : undefined}
      help={error ? <span id={errorId}>{error}</span> : undefined}
    >
      {type === "date" ? (
        <DateInput label={label} value={String(value)} onChange={onChange} required={required} />
      ) : personNames ? (
        <PersonNamesInput aria-label={label} value={String(value)} onChange={onChange} required={required} />
      ) : (
        <Input
          aria-label={label}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
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
