import { useContext, useLayoutEffect, useMemo, useRef } from "react";

import { useTaskFeedback, type FeedbackLevel, type OperationFeedbackApi } from "../components/TaskFeedbackContext";
import { DialogActivityContext } from "../state/dialogActivity";

/** User-operation feedback shares the application host and respects a retired dialog's scope. */
export function useOperationFeedback(): OperationFeedbackApi {
  const { operations } = useTaskFeedback();
  const active = useContext(DialogActivityContext);
  const live = useRef(active);
  useLayoutEffect(() => {
    live.current = active;
    return () => {
      live.current = false;
    };
  }, [active]);
  return useMemo(() => {
    const levels: FeedbackLevel[] = ["success", "info", "warning", "error"];
    return Object.fromEntries([
      ...levels.map((level) => [
        level,
        (...args: Parameters<OperationFeedbackApi[typeof level]>) => {
          if (live.current) operations[level](...args);
        },
      ]),
      [
        "message",
        Object.fromEntries(
          levels.map((level) => [
            level,
            (content: string, key?: string) => {
              if (live.current) operations.message[level](content, key);
            },
          ]),
        ),
      ],
    ]) as OperationFeedbackApi;
  }, [operations]);
}
