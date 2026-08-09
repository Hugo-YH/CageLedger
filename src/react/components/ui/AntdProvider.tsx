import { App as AntApp, ConfigProvider, theme as antTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { type PropsWithChildren, useEffect, useMemo, useState } from "react";

import { useUiState } from "../../state/ui";

export function AntdProvider({ children }: PropsWithChildren) {
  const { theme } = useUiState();
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
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
        colorLink: "#0958d9",
        colorLinkHover: "#0958d9",
        // Dashboard labels and descriptions remain readable on neutral surfaces.
        colorTextSecondary: "#595959",
        colorTextDescription: "#595959",
        borderRadius: 6,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
        fontSize: 14,
        controlHeight: 32,
        controlHeightSM: 24,
        controlHeightLG: 40,
        motion: !reducedMotion,
        motionDurationFast: "0.1s",
        motionDurationMid: "0.2s",
        motionDurationSlow: "0.3s",
      },
      components: {
        Button: {
          borderRadius: 6,
          defaultColor: "#262626",
          defaultBorderColor: "#d9d9d9",
          fontWeight: 400,
        },
        Card: { borderRadiusLG: 8 },
        Drawer: { borderRadiusLG: 8 },
        Modal: { borderRadiusLG: 8 },
      },
    }),
    [reducedMotion, resolvedTheme],
  );

  return (
    <ConfigProvider button={{ autoInsertSpace: false }} componentSize="middle" locale={zhCN} theme={config}>
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}
