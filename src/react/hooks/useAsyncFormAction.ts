import { useCallback, useRef, useState } from "react";

import { useLatestRequest } from "./useLatestRequest";

/** Keep validation and submission single-flight, with errors owned by the open form. */
export function useAsyncFormAction(fallbackMessage: string) {
  const busy = useRef(false);
  const request = useLatestRequest();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(
    async <T>(action: () => Promise<T>, onSuccess?: (value: T) => void) => {
      if (busy.current) return;
      busy.current = true;
      const isCurrent = request.begin();
      setPending(true);
      setError("");
      try {
        const value = await action();
        if (isCurrent()) onSuccess?.(value);
      } catch (cause) {
        // Ant Form already associates validation errors with their fields.
        const fieldValidation =
          typeof cause === "object" &&
          cause !== null &&
          "errorFields" in cause &&
          Array.isArray(cause.errorFields) &&
          cause.errorFields.length > 0;
        if (isCurrent() && !fieldValidation) {
          setError(cause instanceof Error ? cause.message : fallbackMessage);
        }
      } finally {
        busy.current = false;
        if (isCurrent()) setPending(false);
      }
    },
    [fallbackMessage, request],
  );
  return { run, pending, error, setError };
}
