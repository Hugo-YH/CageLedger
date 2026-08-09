import { lazy, Suspense, useEffect } from "react";
import { Button, Result } from "antd";
import { useQueryClient } from "@tanstack/react-query";

import { ApiError } from "./api/client";
import { queryKeys } from "./api/queryKeys";
import { useSession } from "./api/session";

const LoginView = lazy(() => import("./features/auth/LoginView").then((module) => ({ default: module.LoginView })));
const ProjectHome = lazy(() =>
  import("./features/project-home/ProjectHome").then((module) => ({ default: module.ProjectHome })),
);
const PublicScanView = lazy(() =>
  import("./features/scanner/PublicScanView").then((module) => ({ default: module.PublicScanView })),
);
const ReactWorkspace = lazy(() =>
  import("./features/shell/ReactWorkspace").then((module) => ({ default: module.ReactWorkspace })),
);

function LoadingScreen() {
  return (
    <main className="react-boot-screen" aria-busy="true" aria-live="polite">
      <img src="/cageledger-icon.svg" alt="" />
      <div>
        <strong>CageLedger</strong>
        <span>正在加载实验室运营台...</span>
      </div>
    </main>
  );
}

export function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      {isPublicScanRoute() ? <PublicScanView /> : isProjectHomeRoute() ? <ProjectHome /> : <AuthenticatedApp />}
    </Suspense>
  );
}

function AuthenticatedApp() {
  const queryClient = useQueryClient();
  const session = useSession();

  useEffect(() => {
    const refreshSession = () => void queryClient.invalidateQueries({ queryKey: queryKeys.session });
    window.addEventListener("cageledger:session-changed", refreshSession);
    return () => window.removeEventListener("cageledger:session-changed", refreshSession);
  }, [queryClient]);

  if (session.isPending) return <LoadingScreen />;
  if (session.error && (!(session.error instanceof ApiError) || session.error.status !== 401)) {
    return <ServiceError />;
  }
  if (!session.data?.user) return <LoginView />;
  return <ReactWorkspace user={session.data.user} />;
}

function ServiceError() {
  return (
    <main className="react-load-error" role="alert">
      <Result
        status="error"
        subTitle="请检查 Python API 是否正在运行，然后重新加载页面。"
        title="无法连接 CageLedger 服务"
        extra={
          <Button type="primary" onClick={() => window.location.reload()}>
            重新加载
          </Button>
        }
      />
    </main>
  );
}

function isPublicScanRoute() {
  return /^\/(?:c|scan\/cage-card)\/[^/]+$/.test(window.location.pathname);
}

function isProjectHomeRoute() {
  return window.location.pathname === "/" || window.location.pathname === "/index.html";
}
