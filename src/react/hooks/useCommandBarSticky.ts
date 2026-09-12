import { useCallback } from "react";

type ScrollScope = {
  bars: Set<HTMLElement>;
  padding: string;
  offset: string;
};
const scopes = new Map<HTMLElement, ScrollScope>();

function scrollOwner(element: HTMLElement): HTMLElement {
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
    parent = parent.parentElement;
  }
  return document.scrollingElement as HTMLElement;
}

/** Resize-driven only: scrolling itself is handled by CSS, without React updates. */
export function useCommandBarSticky(requested: boolean) {
  return useCallback(
    (bar: HTMLElement | null) => {
      if (!bar || !requested) return;
      const owner = scrollOwner(bar);
      let scope = scopes.get(owner);
      if (!scope) {
        scope = {
          bars: new Set(),
          padding: owner.style.scrollPaddingTop,
          offset: owner.style.getPropertyValue("--cl-workspace-toolbar-offset"),
        };
        scopes.set(owner, scope);
      }
      scope.bars.add(bar);
      let frame = 0;
      const measure = () => {
        const viewportHeight = Math.min(
          window.visualViewport?.height ?? innerHeight,
          owner.clientHeight || innerHeight,
        );
        const eligible = [...scope.bars].filter((item) => {
          const rect = item.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && viewportHeight > 500 && rect.height <= viewportHeight * 0.25;
        });
        // A nested editing/selection area takes precedence over an outer page bar.
        eligible.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
        const active = eligible.at(-1);
        for (const item of scope.bars) item.dataset.sticky = String(item === active);
        // Sticky insets start below a scroll container's padding; anchor/validation
        // scrolling starts at its scrollport edge, so reserve both coordinates.
        const height = active
          ? active.getBoundingClientRect().height +
            (parseFloat(getComputedStyle(owner).paddingTop) || 0) +
            (parseFloat(getComputedStyle(active).top) || 0) +
            8
          : 0;
        if (height) {
          owner.style.setProperty("--cl-workspace-toolbar-offset", `${height}px`);
          owner.style.scrollPaddingTop = `${height}px`;
        } else {
          owner.style.setProperty("--cl-workspace-toolbar-offset", scope.offset);
          owner.style.scrollPaddingTop = scope.padding;
        }
      };
      const schedule = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(measure);
      };
      const observer = new ResizeObserver(schedule);
      observer.observe(bar);
      observer.observe(owner);
      window.addEventListener("resize", schedule);
      window.visualViewport?.addEventListener("resize", schedule);
      measure();
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        window.removeEventListener("resize", schedule);
        window.visualViewport?.removeEventListener("resize", schedule);
        scope.bars.delete(bar);
        delete bar.dataset.sticky;
        if (scope.bars.size) measure();
        else {
          owner.style.setProperty("--cl-workspace-toolbar-offset", scope.offset);
          owner.style.scrollPaddingTop = scope.padding;
          scopes.delete(owner);
        }
      };
    },
    [requested],
  );
}
