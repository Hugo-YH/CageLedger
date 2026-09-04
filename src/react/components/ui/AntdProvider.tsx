import { App as AntApp, ConfigProvider, theme as antTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { type PropsWithChildren, useMemo } from "react";

import { useResolvedTheme } from "../../state/ui";
import { useMediaQuery } from "../../hooks/useMediaQuery";

const BUTTON_CONFIG = { autoInsertSpace: false };

dayjs.locale("zh-cn");

export function AntdProvider({ children }: PropsWithChildren) {
  const resolvedTheme = useResolvedTheme();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const config = useMemo(
    () => ({
      algorithm: resolvedTheme === "dark" ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
      token: {
        // Ant Design v6 official blue seed; components derive accessible hover and active palettes.
        colorPrimary: "#1677ff",
        colorInfo: "#0958d9",
        colorSuccess: "#389e0d",
        colorWarning: "#d48806",
        colorError: "#cf1322",
        colorLink: "#0958d9",
        colorLinkHover: "#1677ff",
        // Dark surfaces use the algorithm's light text instead of the light-theme gray override.
        ...(resolvedTheme === "light" ? { colorTextSecondary: "#595959", colorTextDescription: "#595959" } : {}),
        borderRadius: 6,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
        fontSize: 14,
        controlHeight: 32,
        controlHeightSM: 24,
        controlHeightLG: 40,
        motion: !reducedMotion,
        motionDurationFast: "0.14s",
        motionDurationMid: "0.22s",
        motionDurationSlow: "0.28s",
      },
      components: {
        Button: {
          borderRadius: 6,
          ...(resolvedTheme === "light" ? { defaultColor: "#262626", defaultBorderColor: "#d9d9d9" } : {}),
          // Solid controls keep the official blue seed for branding and use blue-7 with white text for AA contrast.
          colorPrimary: "var(--primary-control)",
          colorPrimaryHover: "var(--primary-control-hover)",
          colorPrimaryActive: "var(--primary-control-active)",
          fontWeight: 400,
        },
        Card: { borderRadiusLG: 8 },
        Drawer: { borderRadiusLG: 8 },
        Menu: {
          darkItemSelectedBg: "#0958d9",
          darkItemSelectedColor: "#fff",
        },
        Tabs: {
          inkBarColor: "var(--primary)",
          itemActiveColor: "var(--primary-text)",
          itemHoverColor: "var(--primary-text)",
          itemSelectedColor: "var(--primary-text)",
        },
        Modal: { borderRadiusLG: 8 },
      },
    }),
    [reducedMotion, resolvedTheme],
  );

  return (
    <ConfigProvider button={BUTTON_CONFIG} componentSize="middle" locale={zhCN} theme={config}>
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}
