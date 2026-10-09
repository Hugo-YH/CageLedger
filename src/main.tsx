import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { App } from "./react/App";
import { AppErrorBoundary } from "./react/components/AppErrorBoundary";
import { queryClient } from "./react/api/queryClient";
import { TaskFeedbackProvider } from "./react/components/TaskFeedback";
import { AntdProvider } from "./react/components/ui/AntdProvider";
import { UiProvider } from "./react/state/ui";
import { startDiagnostics } from "./react/diagnostics/collector";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#root");

if (!root) throw new Error("Missing #root application mount point");

performance.mark("cageledger:react-start");
const stopDiagnostics = startDiagnostics();
if (import.meta.hot) import.meta.hot.dispose(stopDiagnostics);
createRoot(root).render(
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <UiProvider>
        <AntdProvider>
          <TaskFeedbackProvider>
            <App />
          </TaskFeedbackProvider>
        </AntdProvider>
      </UiProvider>
    </QueryClientProvider>
  </AppErrorBoundary>,
);
