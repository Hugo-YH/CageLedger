import {
  cloneElement,
  isValidElement,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const VIEWPORT_PADDING = 16;
const TOOLTIP_GAP = 8;

type TooltipPosition = {
  top: number;
  left: number;
  arrowLeft: number;
  arrowTop: number;
  side: "top" | "bottom" | "left" | "right";
};

type TooltipTriggerProps = {
  onClick?: (event: ReactMouseEvent) => void;
  "aria-expanded"?: boolean;
};

export function Tooltip({
  children,
  content,
  id,
  className = "",
  tapToToggle = false,
}: {
  children: ReactNode;
  content: ReactNode;
  id?: string;
  className?: string;
  tapToToggle?: boolean;
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
      const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);
      const candidates: Array<{ side: TooltipPosition["side"]; top: number; left: number; fits: boolean }> = [
        {
          side: "bottom",
          top: anchor.bottom + TOOLTIP_GAP,
          left: anchor.left + anchor.width / 2 - width / 2,
          fits: anchor.bottom + TOOLTIP_GAP + height <= window.innerHeight - VIEWPORT_PADDING,
        },
        {
          side: "top",
          top: anchor.top - height - TOOLTIP_GAP,
          left: anchor.left + anchor.width / 2 - width / 2,
          fits: anchor.top - TOOLTIP_GAP - height >= VIEWPORT_PADDING,
        },
        {
          side: "right",
          top: anchor.top + anchor.height / 2 - height / 2,
          left: anchor.right + TOOLTIP_GAP,
          fits: anchor.right + TOOLTIP_GAP + width <= window.innerWidth - VIEWPORT_PADDING,
        },
        {
          side: "left",
          top: anchor.top + anchor.height / 2 - height / 2,
          left: anchor.left - width - TOOLTIP_GAP,
          fits: anchor.left - TOOLTIP_GAP - width >= VIEWPORT_PADDING,
        },
      ];
      const candidate = candidates.find((item) => item.fits) || candidates[0];
      const left = clamp(candidate.left, VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING);
      const top = clamp(candidate.top, VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING);
      const arrowLeft = clamp(anchor.left + anchor.width / 2 - left, 12, width - 12);
      const arrowTop = clamp(anchor.top + anchor.height / 2 - top, 12, height - 12);
      setPosition({ top, left, arrowLeft, arrowTop, side: candidate.side });
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
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("blur", close);
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  const trigger =
    tapToToggle && isValidElement<TooltipTriggerProps>(children)
      ? cloneElement(children, {
          "aria-expanded": open,
          onClick: (event: ReactMouseEvent) => {
            children.props.onClick?.(event);
            if (!event.defaultPrevented) setOpen((visible) => !visible);
          },
        })
      : children;

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
      {trigger}
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
                      "--tooltip-arrow-top": `${position.arrowTop}px`,
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
    <Tooltip content={children} id={id} className="help-tooltip-anchor" tapToToggle>
      <button aria-describedby={id} aria-label={label} className="inspection-help-trigger" type="button">
        ?
      </button>
    </Tooltip>
  );
}
