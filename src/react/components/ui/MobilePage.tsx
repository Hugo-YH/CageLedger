import { NavBar, SafeArea } from "antd-mobile";
import { type ReactNode } from "react";

export function MobilePage({
  title,
  actions,
  onBack,
  titleAsHeading = true,
  feature,
  desktop,
  children,
}: {
  title: string;
  actions?: ReactNode;
  onBack?: () => void;
  titleAsHeading?: boolean;
  feature?: string;
  /** Keep the body mounted when a responsive page switches to its desktop shell. */
  desktop?: { className: string; bodyClassName: string; feature?: string; toolbar?: ReactNode };
  children: ReactNode;
}) {
  return (
    <section
      className={desktop?.className || "workspace-view ant-mobile-page"}
      data-ui={desktop ? undefined : "mobile-page"}
      data-feature={desktop?.feature ?? feature}
    >
      {desktop ? (
        desktop.toolbar
      ) : (
        <NavBar back={onBack ? undefined : null} onBack={onBack} right={actions}>
          {titleAsHeading ? (
            <h2 className="ant-mobile-page-title">{title}</h2>
          ) : (
            <span className="ant-mobile-page-title">{title}</span>
          )}
        </NavBar>
      )}
      {!desktop && <SafeArea position="top" />}
      <div className={desktop?.bodyClassName || "ant-mobile-page-body"}>{children}</div>
      {!desktop && <SafeArea position="bottom" />}
    </section>
  );
}
