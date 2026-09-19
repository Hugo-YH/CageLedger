import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { createTheme, resolveTheme, visualSystem } from "../src/theme/visual-system.mjs";

const path = fileURLToPath(new URL("../src/styles/brand-tokens.css", import.meta.url));

export async function renderThemeCss() {
  const blocks = ["light", "dark"].map((mode) => {
    const t = resolveTheme(mode);
    const config = createTheme(mode);
    const dark = mode === "dark";
    const values = {
      "font-sans": t.fontFamily,
      "font-mono": t.fontFamilyCode,
      "font-size-body": `${t.fontSize}px`,
      "font-size-small": `${t.fontSizeSM}px`,
      "font-size-section": `${t.fontSizeLG}px`,
      "font-size-page": `${t.fontSizeHeading2}px`,
      "line-height-body": t.lineHeight,
      "line-height-small": t.lineHeightSM,
      "line-height-page": t.lineHeightHeading2,
      "control-height": `${t.controlHeight}px`,
      "control-height-small": `${t.controlHeightSM}px`,
      "control-height-mobile": `${createTheme(mode, { mobile: true }).token.controlHeight}px`,
      "form-max-width": `${visualSystem.formMaxWidth}px`,
      "brand-1": t.colorLink,
      "brand-2": t.colorLinkHover,
      "brand-3": t.colorLinkActive,
      "color-bg": t.colorBgLayout,
      "color-surface": t.colorBgContainer,
      "color-surface-soft": t.colorFillQuaternary,
      "color-elevated": t.colorBgElevated,
      "color-text": t.colorText,
      "color-text-secondary": t.colorTextSecondary,
      "color-text-tertiary": t.colorTextDescription,
      "color-inverse": t.colorTextLightSolid,
      "color-border": t.colorBorder,
      "color-border-secondary": t.colorBorderSecondary,
      "color-fill": t.colorFillSecondary,
      "color-mask": t.colorBgMask,
      "color-primary": t.colorPrimary,
      "color-primary-bg": t.colorPrimaryBg,
      "color-primary-border": t.colorPrimaryBorder,
      "color-primary-control": config.components.Button.colorPrimary,
      "color-primary-control-hover": config.components.Button.colorPrimaryHover,
      "color-primary-control-active": config.components.Button.colorPrimaryActive,
      "color-success": t.colorSuccess,
      "color-warning": t.colorWarning,
      "color-error": t.colorError,
      "color-info": t.colorInfo,
      "color-sider": visualSystem.siderBackground,
      "color-success-bg": t.colorSuccessBg,
      "color-success-border": t.colorSuccessBorder,
      "color-success-text": t.green8,
      "color-warning-bg": t.colorWarningBg,
      "color-warning-border": t.colorWarningBorder,
      "color-warning-text": dark ? t.gold8 : t.gold9,
      "color-error-bg": t.colorErrorBg,
      "color-error-border": t.colorErrorBorder,
      "color-error-text": dark ? t.red8 : t.red7,
      "color-info-bg": t.colorInfoBg,
      "color-info-border": t.colorInfoBorder,
      "color-info-text": t.colorLink,
      "color-reserved": t.purple6,
      "color-reserved-bg": t.purple1,
      "color-reserved-border": t.purple3,
      "color-reserved-text": dark ? t.purple8 : t.purple7,
      "space-1": "4px",
      "space-2": "8px",
      "space-4": "16px",
      "space-6": "24px",
      "space-8": "32px",
      "radius-control": `${t.borderRadius}px`,
      "radius-card": `${t.borderRadiusLG}px`,
      "shadow-card": "none",
      "shadow-overlay": t.boxShadowSecondary,
      "z-base": 0,
      "z-sticky": 10,
      "z-dropdown": t.zIndexPopupBase,
      "z-modal": t.zIndexPopupBase,
      "z-toast": t.zIndexPopupBase + 10,
      "motion-fast": t.motionDurationFast,
      "motion-base": t.motionDurationMid,
      "motion-overlay": t.motionDurationSlow,
      "ease-out": t.motionEaseOut,
      "ease-in-out": t.motionEaseInOut,
      "ease-drawer": t.motionEaseInOutCirc,
    };
    const selector = dark ? ':root[data-theme="dark"], :root.dark' : ":root";
    return `${selector} {\n${Object.entries(values)
      .map(([key, value]) => `  --cl-${key}: ${cssValue(String(value))};`)
      .join("\n")}\n}`;
  });
  return prettier.format(
    `/* Generated from src/theme/visual-system.mjs. Run node scripts/generate_theme.mjs. */\n${blocks.join("\n\n")}\n\n@media (prefers-reduced-motion: reduce) { :root, :root[data-theme="dark"], :root.dark { --cl-motion-fast: 0s; --cl-motion-base: 0s; --cl-motion-overlay: 0s; } }\n`,
    { ...(await prettier.resolveConfig(path)), parser: "css" },
  );
}

// Preserve Ant values while serializing them in the repository's CSS notation.
function cssValue(value) {
  if (/^\d+\.\d+$/.test(value)) return String(Number(Number(value).toFixed(4)));
  return value
    .replace(/\b(BlinkMacSystemFont|Roboto|Arial|Consolas|Menlo|Courier)\b/g, (font) => font.toLowerCase())
    .replace(/#([\da-f])\1([\da-f])\2([\da-f])\3\b/gi, "#$1$2$3")
    .replace(/rgba\(([^)]+)\)/g, (_, channels) => {
      const [r, g, b, alpha] = channels.split(",").map(Number);
      return `rgb(${r} ${g} ${b} / ${Number((alpha * 100).toFixed(4))}%)`;
    });
}

const css = await renderThemeCss();
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== css) throw new Error("主题变量未同步：运行 node scripts/generate_theme.mjs");
} else {
  writeFileSync(path, css);
}
