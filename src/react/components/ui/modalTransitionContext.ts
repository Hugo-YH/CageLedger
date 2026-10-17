import { createContext } from "react";

/** One boundary owns one outer modal; nested confirmations keep their own lifecycle. */
export const ModalTransitionContext = createContext<{
  open: boolean;
  afterClose: () => void;
} | null>(null);
