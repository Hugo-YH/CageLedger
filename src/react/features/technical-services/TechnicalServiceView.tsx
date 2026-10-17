import { useMemo } from "react";
import { AuditOutlined, FileExcelOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Space } from "antd";

import { createTheme } from "../../../theme/visual-system.mjs";
import type { WorkspaceView } from "../../state/ui";
import { useUiState } from "../../state/ui";
import { useViewVisibility } from "../../state/systemFeatureVisibility";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { CommandBar } from "../../components/ui";
import { SavedServices } from "./SavedServices";
import { ServiceEditor } from "./ServiceEditor";

export function TechnicalServiceView({
  mode,
  navigate,
  canExport,
}: {
  mode: "entry" | "saved";
  navigate: (view: WorkspaceView) => void;
  canExport: boolean;
}) {
  const visible = useViewVisibility();
  const touch = useMediaQuery("(max-width: 767px), (max-height: 480px) and (orientation: landscape)");
  const ui = useUiState();
  const dark = useMediaQuery("(prefers-color-scheme: dark)");
  const themeMode = ui.theme === "system" ? (dark ? "dark" : "light") : ui.theme;
  const serviceTheme = useMemo(() => {
    const theme = createTheme(themeMode, { mobile: touch });
    // The outer AntdProvider owns motion and installs its provider on mount.
    // Inherit it here so a preference change cannot insert a new wrapper and
    // remount the live service form.
    if (theme.token) delete theme.token.motion;
    return theme;
  }, [themeMode, touch]);
  const title = mode === "entry" ? "录入技术服务明细" : "已保存技术服务明细";
  const actions = (
    <Space wrap>
      {visible("workflow-center") ? (
        <Button icon={<AuditOutlined aria-hidden />} onClick={() => navigate("workflow-center")}>
          单据跟踪
        </Button>
      ) : null}
      {canExport && visible("billing-monthly-summary") ? (
        <Button icon={<FileExcelOutlined aria-hidden />} onClick={() => navigate("billing-monthly-summary")}>
          汇总导出
        </Button>
      ) : null}
    </Space>
  );
  return (
    <ConfigProvider theme={serviceTheme}>
      <section
        className="workspace-view technical-service-workspace"
        data-feature="technical-services"
        aria-label={title}
      >
        <div className="workspace-body technical-service-layout">
          {mode === "entry" ? (
            <ServiceEditor toolbarActions={actions} />
          ) : (
            <>
              <CommandBar
                title={title}
                description="技术服务费独立计费，与饲养费共用单据跟踪及汇总导出。"
                ariaLabel={`${title}操作`}
                actions={actions}
              />
              <SavedServices />
            </>
          )}
        </div>
      </section>
    </ConfigProvider>
  );
}
