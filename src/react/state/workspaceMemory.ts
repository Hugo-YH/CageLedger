import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

export const WorkspaceMemory = createContext<Map<string, unknown> | null>(null);

export function useWorkspaceMemory<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const memory = useContext(WorkspaceMemory);
  const [value, setValue] = useState<T>(() => (memory?.has(key) ? (memory.get(key) as T) : initial));
  useEffect(() => {
    memory?.set(key, value);
  }, [memory, key, value]);
  return [value, setValue];
}

function workspaceScrollTarget() {
  const workspace = document.querySelector<HTMLElement>("[data-ui=workspace]");
  return workspace && /(auto|scroll)/.test(getComputedStyle(workspace).overflowY)
    ? workspace
    : document.scrollingElement;
}

/** Snapshot at confirmed navigation, not on every scroll event. */
export function useSaveWorkspaceScroll() {
  const memory = useContext(WorkspaceMemory);
  return useCallback(
    (key: string) => {
      const target = workspaceScrollTarget();
      if (target) memory?.set(`${key}:scroll`, target.scrollTop);
    },
    [memory],
  );
}

/** Restore once when the mounted list is available; no scroll-linked listeners or renders. */
export function useWorkspaceScroll(key: string, ready: boolean) {
  const memory = useContext(WorkspaceMemory);
  const restored = useRef(false);
  useEffect(() => {
    if (!memory || !ready || restored.current) return;
    const saved = memory.get(`${key}:scroll`) as number | undefined;
    const frame = requestAnimationFrame(() => {
      const target = workspaceScrollTarget();
      if (target && saved !== undefined) target.scrollTop = saved;
      restored.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [memory, key, ready]);
}
