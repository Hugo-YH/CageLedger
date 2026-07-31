import { NavBar, SafeArea } from "antd-mobile";
import { type ReactNode } from "react";

export function MobilePage({
  title,
  actions,
  onBack,
  titleAsHeading = true,
  children,
}: {
  title: string;
  actions?: ReactNode;
  onBack?: () => void;
  titleAsHeading?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="workspace-view ant-mobile-page">
      <NavBar back={onBack ? undefined : null} onBack={onBack} right={actions}>
        {titleAsHeading ? (
          <h2 className="ant-mobile-page-title">{title}</h2>
        ) : (
          <span className="ant-mobile-page-title">{title}</span>
        )}
      </NavBar>
      <SafeArea position="top" />
      <div className="ant-mobile-page-body">{children}</div>
      <SafeArea position="bottom" />
    </section>
  );
}
