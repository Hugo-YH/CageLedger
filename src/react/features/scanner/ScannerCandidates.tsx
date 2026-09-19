import { useEffect, useRef } from "react";
import { Button, Flex } from "antd";
import type { ScannerChoices } from "./frozenQr";
import { normalizeCode } from "./scannerCode";

export function ScannerCandidates({
  choices,
  onSelect,
}: {
  choices: ScannerChoices;
  onSelect: (index: number) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    group.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, []);
  const ratio = choices.width / choices.height;
  const mapWidth = Math.min(1, ratio);
  const mapHeight = Math.min(1, 1 / ratio);
  return (
    <div ref={group} className="scanner-candidate-picker" role="group" aria-label="选择笼卡二维码">
      <div className="scanner-camera-status" role="status">
        {choices.complete
          ? `识别到 ${choices.candidates.length} 个二维码，请点选`
          : `已识别 ${choices.candidates.length} 个二维码，请点选；未框出的可重新对准扫描`}
      </div>
      {choices.frame ? (
        <div className="scanner-capture scanner-candidate-frame">
          <img className="scanner-frozen-frame" src={choices.frame} alt="待选择二维码的冻结画面" />
          <div
            className="scanner-candidate-map"
            style={{
              width: `${mapWidth * 100}%`,
              height: `${mapHeight * 100}%`,
              left: `${(1 - mapWidth) * 50}%`,
              top: `${(1 - mapHeight) * 50}%`,
            }}
          >
            <svg
              className="scanner-candidate-outlines"
              viewBox={`0 0 ${choices.width} ${choices.height}`}
              aria-hidden="true"
            >
              {choices.candidates.map(({ corners }, index) =>
                corners ? (
                  <polygon
                    key={index}
                    points={corners.map(({ x, y }) => `${x},${y}`).join(" ")}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null,
              )}
            </svg>
            {choices.candidates.map(({ corners }, index) => {
              if (!corners) return null;
              const left = Math.min(...corners.map(({ x }) => x));
              const top = Math.min(...corners.map(({ y }) => y));
              const width = Math.max(...corners.map(({ x }) => x)) - left;
              const height = Math.max(...corners.map(({ y }) => y)) - top;
              return (
                <button
                  key={index}
                  type="button"
                  className="scanner-candidate-hit"
                  aria-label={`选择二维码 ${index + 1}`}
                  style={{
                    left: `${(left / choices.width) * 100}%`,
                    top: `${(top / choices.height) * 100}%`,
                    width: `${(width / choices.width) * 100}%`,
                    height: `${(height / choices.height) * 100}%`,
                  }}
                  onClick={() => onSelect(index)}
                >
                  <span className="scanner-candidate-number">{index + 1}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="scanner-camera-status">无法显示冻结画面，请从下方选择二维码。</div>
      )}
      <Flex gap={8} wrap className="scanner-candidate-options">
        {choices.candidates.map(({ code }, index) => {
          const label = normalizeCode(code.data);
          return (
            <Button
              key={index}
              aria-label={`查看二维码 ${index + 1}：${label}`}
              title={label}
              onClick={() => onSelect(index)}
            >
              {index + 1} · {label.length > 48 ? `${label.slice(0, 48)}…` : label}
            </Button>
          );
        })}
      </Flex>
    </div>
  );
}
