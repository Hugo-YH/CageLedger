import { App as AntApp, ConfigProvider, theme as antTheme } from "antd";
import { ConfigProvider as MobileConfigProvider } from "antd-mobile";
import zhCN from "antd/locale/zh_CN";
import { type PropsWithChildren, useMemo } from "react";

import { useUiState } from "../../state/ui";

export function AntdProvider({ children }: PropsWithChildren) {
  const { theme } = useUiState();
  const resolvedTheme =
    theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  const config = useMemo(
    () => ({
      algorithm: resolvedTheme === "dark" ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
      token: {
        // The darker primary keeps white text at WCAG AA contrast on compact controls.
        colorPrimary: "#0958d9",
        colorInfo: "#0958d9",
        colorSuccess: "#389e0d",
        colorWarning: "#d48806",
        colorError: "#cf1322",
        borderRadius: 6,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
        fontSize: 14,
        controlHeight: 32,
        controlHeightSM: 24,
        controlHeightLG: 40,
        motionDurationFast: "0.12s",
        motionDurationMid: "0.16s",
        motionDurationSlow: "0.22s",
      },
      components: {
        Button: { borderRadius: 6, fontWeight: 500 },
        Card: { borderRadiusLG: 8 },
        Drawer: { borderRadiusLG: 10 },
        Modal: { borderRadiusLG: 10 },
        Table: { headerBg: resolvedTheme === "dark" ? "#1f1f1f" : "#fafafa" },
      },
    }),
    [resolvedTheme],
  );

  return (
    <ConfigProvider button={{ autoInsertSpace: false }} componentSize="middle" locale={zhCN} theme={config}>
      <MobileConfigProvider>
        <AntApp>{children}</AntApp>
      </MobileConfigProvider>
    </ConfigProvider>
  );
}
