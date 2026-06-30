import { createContext, type Dispatch, type PropsWithChildren, useContext, useReducer } from "react";
import { readStoredWorkspaceView } from "./uiStorage";
import type { WorkspaceView } from "./uiTypes";

export type { WorkspaceView } from "./uiTypes";

export interface UiState {
  activeView: WorkspaceView;
  sidebarCollapsed: boolean;
  settingsExpanded: boolean;
}

type UiAction =
  { type: "navigate"; view: WorkspaceView } | { type: "toggle-sidebar" } | { type: "set-settings"; expanded: boolean };

function initialUiState(): UiState {
  return {
    activeView: readStoredWorkspaceView(),
    sidebarCollapsed: false,
    settingsExpanded: false,
  };
}

const initialState: UiState = {
  activeView: "dashboard",
  sidebarCollapsed: false,
  settingsExpanded: false,
};

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "navigate":
      return { ...state, activeView: action.view };
    case "toggle-sidebar":
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
    case "set-settings":
      return { ...state, settingsExpanded: action.expanded };
  }
}

const UiStateContext = createContext<UiState | null>(null);
const UiDispatchContext = createContext<Dispatch<UiAction> | null>(null);

export function UiProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(uiReducer, initialState, initialUiState);
  return (
    <UiStateContext value={state}>
      <UiDispatchContext value={dispatch}>{children}</UiDispatchContext>
    </UiStateContext>
  );
}

export function useUiState() {
  const value = useContext(UiStateContext);
  if (!value) throw new Error("useUiState must be used inside UiProvider");
  return value;
}

export function useUiDispatch() {
  const value = useContext(UiDispatchContext);
  if (!value) throw new Error("useUiDispatch must be used inside UiProvider");
  return value;
}
