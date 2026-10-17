import { createContext } from "react";

/** Retained exit content is visible only; its local tasks and navigation guards are inactive. */
export const DialogActivityContext = createContext(true);
