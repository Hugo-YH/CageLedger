import { Input, type InputProps, type InputRef } from "antd";
import { forwardRef } from "react";

type ReadOnlyInputProps = Omit<InputProps, "readOnly" | "allowClear" | "onChange">;

/** System values remain focusable and selectable for copying. */
export const ReadOnlyInput = forwardRef<InputRef, ReadOnlyInputProps>(function ReadOnlyInput(
  { title = "系统自动填写，无需编辑；可选中复制", ...props },
  ref,
) {
  return <Input {...props} ref={ref} data-ui="read-only-input" readOnly allowClear={false} title={title} />;
});
