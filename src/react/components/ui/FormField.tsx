import { Form, type FormItemProps } from "antd";
import { type ReactNode } from "react";

export function FormField({ children, ...props }: FormItemProps & { children: ReactNode }) {
  return <Form.Item {...props}>{children}</Form.Item>;
}
