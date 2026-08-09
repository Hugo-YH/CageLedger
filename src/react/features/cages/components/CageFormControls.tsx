import { Input, InputNumber, Select } from "antd";

export function Field({
  label,
  value,
  onChange,
  type = "text",
  max,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  max?: string;
}) {
  if (type === "number") {
    return (
      <label>
        {label}
        <InputNumber
          aria-label={label}
          min={0}
          style={{ width: "100%" }}
          value={value === "" ? null : Number(value)}
          onChange={(next) => onChange(next == null ? "" : String(next))}
        />
      </label>
    );
  }
  return (
    <label>
      {label}
      <Input
        aria-label={label}
        max={max}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

const SLOT_STATUS_OPTIONS = [
  { value: "active", label: "在用" },
  { value: "reserved", label: "已预约" },
];

export function SlotStatusSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id}>
      状态
      <Select
        aria-label="状态"
        id={id}
        options={SLOT_STATUS_OPTIONS}
        style={{ width: "100%" }}
        value={value}
        onChange={onChange}
      />
    </label>
  );
}

export function SexSelect({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <label htmlFor={id}>
      性别
      <Select
        aria-label="性别"
        id={id}
        options={[
          { value: "unknown", label: "请选择" },
          { value: "male", label: "雄" },
          { value: "female", label: "雌" },
        ]}
        style={{ width: "100%" }}
        value={value}
        onChange={onChange}
      />
    </label>
  );
}
