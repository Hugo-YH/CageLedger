import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { App } from "./react/App";
import { queryClient } from "./react/api/queryClient";
import { UiProvider } from "./react/state/ui";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#root");

if (!root) throw new Error("Missing #root application mount point");

performance.mark("cageledger:react-start");
createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <UiProvider>
      <App />
    </UiProvider>
  </QueryClientProvider>,
);
