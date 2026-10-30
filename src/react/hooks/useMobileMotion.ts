import { reduceMotion, restoreMotion } from "antd-mobile";
import { useLayoutEffect } from "react";

import { useMediaQuery } from "./useMediaQuery";

/** The single lazy mobile navigation owns the library's JavaScript motion setting. */
export function useMobileMotion() {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  useLayoutEffect(() => {
    if (reducedMotion) reduceMotion();
    else restoreMotion();
    return restoreMotion;
  }, [reducedMotion]);
  return reducedMotion;
}
