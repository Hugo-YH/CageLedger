import { createContext, useContext } from "react";
import { DEFAULT_FEATURE_VISIBILITY, isViewVisible, type WorkspaceView } from "./workspaceViews";

export const SystemFeatureVisibilityContext = createContext(DEFAULT_FEATURE_VISIBILITY);

export function useViewVisibility() {
  const enabled = useContext(SystemFeatureVisibilityContext);
  return (view: WorkspaceView) => isViewVisible(view, enabled);
}
