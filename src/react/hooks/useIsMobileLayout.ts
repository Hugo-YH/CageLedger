import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = "(max-width: 760px)";

export function useIsMobileLayout() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_BREAKPOINT).matches);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_BREAKPOINT);
    const onChange = () => setIsMobile(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}
