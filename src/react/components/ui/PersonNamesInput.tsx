import { Input, type InputProps, type InputRef } from "antd";
import { forwardRef, useState } from "react";
import { formatPersonNames } from "../../../domain/personNames";

type Props = Omit<InputProps, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
};

export const PersonNamesInput = forwardRef<InputRef, Props>(function PersonNamesInput(
  { value, onChange, onFocus, onBlur, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <Input
      {...props}
      ref={ref}
      value={focused ? value : formatPersonNames(value)}
      onChange={(event) => onChange(event.target.value)}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
    />
  );
});
