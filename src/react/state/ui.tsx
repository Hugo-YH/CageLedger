import { createContext, type Dispatch, type PropsWithChildren, useContext, useEffect, useReducer } from "react";
import {
  persistThemePreference,
  readStoredThemePreference,
  readStoredWorkspaceView,
  type ThemePreference,
} from "./uiStorage";
import type { WorkspaceView } from "./uiTypes";
import { useMediaQuery } from "../hooks/useMediaQuery";

export type { WorkspaceView } from "./uiTypes";

export interface UiState {
  activeView: WorkspaceView;
  sidebarCollapsed: boolean;
  settingsExpanded: boolean;
  theme: ThemePreference;
}

type UiAction =
  | { type: "navigate"; view: WorkspaceView }
  | { type: "toggle-sidebar" }
  | { type: "set-settings"; expanded: boolean }
  | { type: "set-theme"; theme: ThemePreference };

function initialUiState(): UiState {
  return {
    activeView: readStoredWorkspaceView(),
    sidebarCollapsed: false,
    settingsExpanded: false,
    theme: readStoredThemePreference(),
  };
}

const initialState: UiState = {
  activeView: "dashboard",
  sidebarCollapsed: false,
  settingsExpanded: false,
  theme: "system",
};

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "navigate":
      return state.activeView === action.view ? state : { ...state, activeView: action.view };
    case "toggle-sidebar":
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
    case "set-settings":
      return state.settingsExpanded === action.expanded ? state : { ...state, settingsExpanded: action.expanded };
    case "set-theme":
      return state.theme === action.theme ? state : { ...state, theme: action.theme };
  }
}

const UiStateContext = createContext<UiState | null>(null);
const UiDispatchContext = createContext<Dispatch<UiAction> | null>(null);
const ResolvedThemeContext = createContext<"light" | "dark" | null>(null);

export function UiProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(uiReducer, initialState, initialUiState);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const resolvedTheme = state.theme === "system" ? (systemDark ? "dark" : "light") : state.theme;
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);
  useEffect(() => persistThemePreference(state.theme), [state.theme]);
  return (
    <UiStateContext value={state}>
      <UiDispatchContext value={dispatch}>
        <ResolvedThemeContext value={resolvedTheme}>{children}</ResolvedThemeContext>
      </UiDispatchContext>
    </UiStateContext>
  );
}

export function useResolvedTheme() {
  const value = useContext(ResolvedThemeContext);
  if (!value) throw new Error("useResolvedTheme must be used inside UiProvider");
  return value;
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
