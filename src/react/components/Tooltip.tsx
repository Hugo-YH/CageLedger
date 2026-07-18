import { type CSSProperties, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_PADDING = 16;
const TOOLTIP_GAP = 8;

type TooltipPosition = {
  top: number;
  left: number;
  arrowLeft: number;
  side: "top" | "bottom";
};

export function Tooltip({
  children,
  content,
  id,
  className = "",
}: {
  children: ReactNode;
  content: ReactNode;
  id?: string;
  className?: string;
}) {
  const generatedId = useId();
  const tooltipId = id || `tooltip-${generatedId}`;
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const tooltip = tooltipRef.current?.getBoundingClientRect();
      if (!anchor || !tooltip) return;
      const width = Math.min(tooltip.width, window.innerWidth - VIEWPORT_PADDING * 2);
      const height = tooltip.height;
      const canOpenBelow = anchor.bottom + TOOLTIP_GAP + height <= window.innerHeight - VIEWPORT_PADDING;
      const side = canOpenBelow || anchor.top - TOOLTIP_GAP - height < VIEWPORT_PADDING ? "bottom" : "top";
      const left = Math.min(
        Math.max(anchor.left + anchor.width / 2 - width / 2, VIEWPORT_PADDING),
        window.innerWidth - width - VIEWPORT_PADDING,
      );
      const top = side === "bottom" ? anchor.bottom + TOOLTIP_GAP : anchor.top - height - TOOLTIP_GAP;
      const arrowLeft = Math.min(Math.max(anchor.left + anchor.width / 2 - left, 12), width - 12);
      setPosition({ top, left, arrowLeft, side });
    };

    const frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("blur", close);
    return () => window.removeEventListener("blur", close);
  }, [open]);

  return (
    <span
      className={`tooltip-anchor ${className}`.trim()}
      ref={anchorRef}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onFocusCapture={() => setOpen(true)}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      {children}
      {open
        ? createPortal(
            <span
              aria-hidden={!open}
              className={`app-tooltip app-tooltip-${position?.side || "bottom"}`}
              id={tooltipId}
              ref={tooltipRef}
              role="tooltip"
              style={
                position
                  ? ({
                      top: `${position.top}px`,
                      left: `${position.left}px`,
                      "--tooltip-arrow-left": `${position.arrowLeft}px`,
                    } as CSSProperties)
                  : undefined
              }
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

export function HelpTooltip({ children, label }: { children: ReactNode; label: string }) {
  const id = useId();
  return (
    <Tooltip content={children} id={id} className="help-tooltip-anchor">
      <button aria-describedby={id} aria-label={label} className="inspection-help-trigger" type="button">
        ?
      </button>
    </Tooltip>
  );
}
