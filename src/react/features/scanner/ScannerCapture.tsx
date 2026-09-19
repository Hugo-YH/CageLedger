import { useLayoutEffect, useRef, useState } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { rectangleToQuad, type Quad } from "./qrGeometry";
import type { ScannerSnapshot } from "./frozenQr";

const HOLD_MS = 140;
const ALIGN_MS = 560;

export function ScannerCapture({ snapshot }: { snapshot: ScannerSnapshot }) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const stageRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLImageElement>(null);
  const presented = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState("located");
  const focus = failed ? null : snapshot.focus;

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const plane = planeRef.current;
    const frame = frameRef.current;
    if (!stage || !plane || !frame || !focus || !ready) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let animations: Animation[] = [];
    let previousSize = "";
    const cancel = () => {
      clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
      animations = [];
    };
    const layout = () => {
      const { width, height } = stage.getBoundingClientRect();
      const nextSize = `${width}:${height}`;
      if (!width || !height || previousSize === nextSize) return;
      previousSize = nextSize;
      cancel();
      const scale = Math.min(width / snapshot.width, height / snapshot.height);
      const left = (width - snapshot.width * scale) / 2;
      const top = (height - snapshot.height * scale) / 2;
      const original = focus.corners.map(({ x, y }) => ({
        x: left + x * scale,
        y: top + y * scale,
      })) as unknown as Quad;
      const side = Math.min(width, height) * 0.88;
      const x = (width - side) / 2;
      const y = (height - side) / 2;
      const target: Quad = [
        { x, y },
        { x: x + side, y },
        { x: x + side, y: y + side },
        { x, y: y + side },
      ];
      const start = rectangleToQuad(focus.size, focus.size, original);
      const end = rectangleToQuad(focus.size, focus.size, target);
      if (!start || !end) return;
      const from = `matrix3d(${start.join(",")})`;
      const to = `matrix3d(${end.join(",")})`;
      plane.style.transform = to;
      plane.style.visibility = "visible";
      frame.style.opacity = "0";
      const finish = () => {
        if (!disposed) setPhase("aligned");
      };
      // Resize, live preference changes and older browsers settle immediately.
      if (presented.current || reducedMotion || typeof plane.animate !== "function") {
        presented.current = true;
        finish();
        return;
      }
      presented.current = true;
      try {
        const timing = {
          duration: ALIGN_MS,
          delay: HOLD_MS,
          easing: getComputedStyle(stage).getPropertyValue("--ease-in-out").trim() || "cubic-bezier(0.2, 0, 0, 1)",
          fill: "both" as const,
        };
        const alignment = plane.animate([{ transform: from }, { transform: to }], timing);
        animations.push(alignment);
        void alignment.finished.then(finish, () => undefined);
        animations.push(frame.animate([{ opacity: 1 }, { opacity: 0 }], timing));
        timer = setTimeout(() => {
          if (!disposed) setPhase("aligning");
        }, HOLD_MS);
      } catch {
        cancel();
        finish();
      }
    };
    layout();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(layout);
    observer?.observe(stage);
    window.addEventListener("resize", layout);
    return () => {
      disposed = true;
      cancel();
      frame.style.opacity = "";
      observer?.disconnect();
      window.removeEventListener("resize", layout);
    };
  }, [snapshot, focus, ready, reducedMotion]);

  const status = !focus
    ? "已识别，画面已冻结"
    : phase === "aligned"
      ? "二维码已校正，笼卡信息见下方"
      : phase === "aligning"
        ? "正在放大校正二维码"
        : "已定位二维码，画面已冻结";
  return (
    <>
      <div className="scanner-capture" ref={stageRef} data-phase={focus ? phase : "frozen"}>
        <img
          ref={frameRef}
          className="scanner-frozen-frame"
          src={snapshot.frame}
          alt={focus ? "识别时的原始画面" : "已识别笼卡的冻结画面"}
        />
        {focus ? (
          <div className="scanner-qr-plane" ref={planeRef} style={{ width: focus.size, height: focus.size }}>
            <img
              src={focus.image}
              alt="已识别笼卡的冻结画面"
              onLoad={() => setReady(true)}
              onError={() => setFailed(true)}
            />
            <svg className="scanner-qr-outline" viewBox={`0 0 ${focus.size} ${focus.size}`} aria-hidden="true">
              <rect x="1" y="1" width={focus.size - 2} height={focus.size - 2} vectorEffect="non-scaling-stroke" />
              <path
                d={`M0 48V0H48 M${focus.size - 48} 0H${focus.size}V48 M${focus.size} ${focus.size - 48}V${focus.size}H${focus.size - 48} M48 ${focus.size}H0V${focus.size - 48}`}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        ) : null}
        {focus && ready && phase === "located" ? (
          <svg
            className="scanner-source-outline"
            viewBox={`0 0 ${snapshot.width} ${snapshot.height}`}
            aria-hidden="true"
          >
            <polygon
              points={focus.corners.map(({ x, y }) => `${x},${y}`).join(" ")}
              vectorEffect="non-scaling-stroke"
            />
            {focus.corners.map(({ x, y }, index) => (
              <circle key={index} cx={x} cy={y} r={snapshot.width * 0.008} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        ) : null}
      </div>
      <div className="scanner-camera-status" role="status">
        {status}
      </div>
    </>
  );
}
