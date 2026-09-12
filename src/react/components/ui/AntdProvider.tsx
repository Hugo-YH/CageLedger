import { App as AntApp, ConfigProvider, theme as antTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { type PropsWithChildren, useEffect, useMemo, useState } from "react";

import { useResolvedTheme } from "../../state/ui";
import { useMediaQuery } from "../../hooks/useMediaQuery";

const BUTTON_CONFIG = { autoInsertSpace: false };

dayjs.locale("zh-cn");

export function AntdProvider({ children }: PropsWithChildren) {
  const resolvedTheme = useResolvedTheme();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  // Ant 6.5 adds its motion providers on the first disabled-motion render. Install
  // them on mount so a later preference change cannot remount forms and lose drafts.
  const [motionReady, setMotionReady] = useState(false);
  useEffect(() => setMotionReady(true), []);
  const config = useMemo(
    () => ({
      algorithm: resolvedTheme === "dark" ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
      token: {
        // Ant Design v6 official blue seed; components derive accessible hover and active palettes.
        colorPrimary: "#1677ff",
        colorInfo: "#0958d9",
        colorSuccess: "#389e0d",
        colorWarning: "#d48806",
        colorError: resolvedTheme === "dark" ? "#ff7875" : "#cf1322",
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
        motion: motionReady && !reducedMotion,
        motionDurationFast: "0.14s",
        motionDurationMid: "0.22s",
        motionDurationSlow: "0.28s",
      },
      components: {
        Button: {
          borderRadius: 6,
          ...(resolvedTheme === "light" ? { defaultColor: "#262626", defaultBorderColor: "#d9d9d9" } : {}),
          ...(resolvedTheme === "dark" ? { dangerColor: "#141414" } : {}),
          // Solid controls keep the official blue seed for branding and use blue-7 with white text for AA contrast.
          colorPrimary: "var(--primary-control)",
          colorPrimaryHover: "var(--primary-control-hover)",
          colorPrimaryActive: "var(--primary-control-active)",
          fontWeight: 400,
        },
        Card: { borderRadiusLG: 8 },
        Tag: {
          ...(resolvedTheme === "light"
            ? {
                // Use deeper Ant palette steps for readable 12px status labels.
                colorSuccess: "#237804",
                colorSuccessBg: "#f6ffed",
                colorWarning: "#874d00",
                colorWarningBg: "#fffbe6",
                colorError: "#cf1322",
                colorErrorBg: "#fff2f0",
                colorInfo: "#0958d9",
                colorInfoBg: "#e6f4ff",
                green7: "#237804",
                gold7: "#874d00",
                orange7: "#ad4e00",
                cyan7: "#006d75",
                lime7: "#3f6600",
                yellow7: "#614700",
              }
            : {
                colorSuccess: "#b7eb8f",
                colorSuccessBg: "#16382a",
                colorWarning: "#ffe58f",
                colorWarningBg: "#423719",
                colorError: "#ff8a80",
                colorErrorBg: "#442927",
                colorInfo: "#91caff",
                colorInfoBg: "#112a45",
              }),
        },
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
    [motionReady, reducedMotion, resolvedTheme],
  );

  return (
    <ConfigProvider button={BUTTON_CONFIG} componentSize="middle" locale={zhCN} theme={config}>
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}
