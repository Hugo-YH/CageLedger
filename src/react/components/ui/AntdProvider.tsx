import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { type PropsWithChildren, useEffect, useMemo, useState } from "react";

import { createButtonConfig, createTheme } from "../../../theme/visual-system.mjs";

import { useResolvedTheme } from "../../state/ui";
import { useMediaQuery } from "../../hooks/useMediaQuery";

dayjs.locale("zh-cn");

export function AntdProvider({ children }: PropsWithChildren) {
  const resolvedTheme = useResolvedTheme();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  // Ant 6.5 adds its motion providers on the first disabled-motion render. Install
  // them on mount so a later preference change cannot remount forms and lose drafts.
  const [motionReady, setMotionReady] = useState(false);
  useEffect(() => setMotionReady(true), []);
  const mobile = useMediaQuery("(max-width: 767px)");
  const config = useMemo(
    () => createTheme(resolvedTheme, { mobile, motion: motionReady && !reducedMotion }),
    [mobile, motionReady, reducedMotion, resolvedTheme],
  );
  const buttonConfig = useMemo(() => createButtonConfig(resolvedTheme), [resolvedTheme]);

  return (
    <ConfigProvider button={buttonConfig} componentSize="medium" locale={zhCN} theme={config}>
      <AntApp
        message={{ duration: 3, maxCount: 3 }}
        notification={{
          placement: mobile ? "top" : "topRight",
          // Leave room for a concurrent lightweight Message above the notice stack.
          top: mobile ? 96 : 80,
          stack: { threshold: 3 },
          pauseOnHover: true,
          styles: {
            root: {
              maxWidth: "calc(100vw - 32px)",
              maxHeight: mobile ? "calc(100dvh - 120px)" : "calc(100dvh - 104px)",
              overflowY: "auto",
              overflowWrap: "anywhere",
            },
          },
        }}
      >
        {children}
      </AntApp>
    </ConfigProvider>
  );
}
