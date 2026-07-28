import { Button, type ButtonProps } from "antd";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ActionTone = "primary" | "secondary" | "tertiary" | "destructive" | "icon";

type NativeButtonType = NonNullable<ButtonHTMLAttributes<HTMLButtonElement>["type"]>;

export type ActionButtonProps = Omit<ButtonProps, "danger" | "htmlType" | "type"> & {
  /** Compatible with native button call sites while rendering Ant Button. */
  type?: NativeButtonType;
  tone?: ActionTone;
  children: ReactNode;
};

export function ActionButton({ tone = "secondary", children, type = "button", ...props }: ActionButtonProps) {
  const buttonType = tone === "primary" ? "primary" : tone === "tertiary" || tone === "icon" ? "text" : "default";
  return (
    <Button danger={tone === "destructive"} htmlType={type} type={buttonType} {...props}>
      {children}
    </Button>
  );
}
