import { describe, expect, it } from "vitest";
import { createTheme, resolveTheme } from "./visual-system.mjs";

function rgb(color: string, background = [255, 255, 255]): number[] {
  if (color.startsWith("#")) {
    const value =
      color.length === 4
        ? color
            .slice(1)
            .split("")
            .map((c) => c + c)
            .join("")
        : color.slice(1);
    return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  }
  const values = color.match(/[\d.]+/g)!.map(Number);
  const alpha = values[3] ?? 1;
  return values.slice(0, 3).map((value, index) => value * alpha + background[index] * (1 - alpha));
}

function contrast(foreground: string, background: string) {
  const base = rgb(background);
  function luminance(channels: number[]) {
    return channels
      .map((n) => n / 255)
      .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
      .reduce((sum, n, index) => sum + n * [0.2126, 0.7152, 0.0722][index], 0);
  }
  const values = [luminance(rgb(foreground, base)), luminance(base)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe.each(["light", "dark"] as const)("%s visual system", (mode) => {
  it("keeps normal text and primary controls readable in every interaction state", () => {
    const token = resolveTheme(mode);
    const button = createTheme(mode).components!.Button!;
    for (const surface of [token.colorBgContainer, token.colorBgLayout, token.colorBgElevated]) {
      for (const text of [token.colorText, token.colorTextSecondary, token.colorTextDescription, token.colorLink]) {
        expect(contrast(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const color of [button.colorPrimary, button.colorPrimaryHover, button.colorPrimaryActive]) {
      expect(contrast(token.colorTextLightSolid, color!)).toBeGreaterThanOrEqual(4.5);
    }
    for (const color of [button.colorError, button.colorErrorHover, button.colorErrorActive]) {
      expect(contrast(color!, token.colorBgContainer)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(button.dangerColor ?? token.colorTextLightSolid, color!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses official motion while reduced-motion eliminates it without changing layout", () => {
    const token = resolveTheme(mode);
    expect([token.motionDurationFast, token.motionDurationMid, token.motionDurationSlow]).toEqual([
      "0.1s",
      "0.2s",
      "0.3s",
    ]);
    expect(createTheme(mode, { motion: false }).token?.motion).toBe(false);
    expect(createTheme(mode, { mobile: true }).components?.Button?.controlHeight).toBeGreaterThanOrEqual(44);
  });

  it("keeps semantic status labels readable without relying on color alone", () => {
    const tag = createTheme(mode).components!.Tag!;
    for (const state of ["Success", "Warning", "Error", "Info"] as const) {
      expect(contrast(tag[`color${state}`]!, tag[`color${state}Bg`]!), state).toBeGreaterThanOrEqual(4.5);
    }
    const typography = createTheme(mode).components!.Typography!;
    for (const state of ["Success", "Warning", "Error"] as const) {
      expect(contrast(typography[`color${state}`]!, resolveTheme(mode).colorBgContainer), state).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
});
