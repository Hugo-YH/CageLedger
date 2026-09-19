import { theme } from "antd";

/** Shared by ConfigProvider and the static CSS generator. No page-owned palette. */
export const visualSystem = {
  mobileBreakpoint: 768,
  siderBackground: "#001529",
  formMaxWidth: 1200,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "PingFang SC", "Microsoft YaHei", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
};

/** @param {"light" | "dark"} mode @param {{ mobile?: boolean, motion?: boolean }} options
 * @returns {import("antd").ThemeConfig} */
export function createTheme(mode, { mobile = false, motion = true } = {}) {
  const dark = mode === "dark";
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;
  const palette = theme.getDesignToken({ algorithm });
  const primaryControl = dark ? palette.blue6 : palette.blue7;
  // Recompute typography aliases with the mobile font seed: fontHeight, lineHeight
  // and vertical padding must change together to preserve the 40px control height.
  const inputTypography = mobile ? { algorithm: true, fontSize: 16, lineHeight: 1.5 } : {};
  return {
    algorithm,
    token: {
      colorPrimary: "#1677ff",
      fontFamily: visualSystem.fontFamily,
      fontSize: 14,
      fontSizeHeading2: 24,
      lineHeightHeading2: 32 / 24,
      fontWeightStrong: 600,
      lineHeight: 22 / 14,
      borderRadius: 6,
      borderRadiusLG: 8,
      controlHeight: mobile ? 40 : 32,
      controlHeightSM: 24,
      controlHeightLG: 40,
      // Normal supporting text must remain readable on both container and layout surfaces.
      colorTextDescription: palette.colorTextSecondary,
      colorTextTertiary: palette.colorTextSecondary,
      colorLink: dark ? palette.blue8 : palette.blue7,
      colorLinkHover: dark ? palette.blue9 : palette.blue8,
      colorLinkActive: dark ? palette.blue7 : palette.blue9,
      motion,
    },
    components: {
      Button: {
        ...(mobile ? { controlHeight: 44, controlHeightSM: 44 } : {}),
        colorPrimary: primaryControl,
        colorPrimaryHover: dark ? palette.blue5 : palette.blue8,
        colorPrimaryActive: dark ? palette.blue4 : palette.blue9,
        colorError: dark ? palette.red8 : palette.red7,
        colorErrorHover: dark ? palette.red9 : palette.red8,
        colorErrorActive: dark ? palette.red7 : palette.red9,
        ...(dark ? { dangerColor: palette.colorBgContainer } : {}),
        fontWeight: 400,
      },
      Tabs: { itemSelectedColor: dark ? palette.blue8 : palette.blue7 },
      Typography: {
        colorSuccess: palette.green8,
        colorWarning: dark ? palette.gold8 : palette.gold9,
        colorError: dark ? palette.red8 : palette.red7,
      },
      Menu: { darkItemSelectedBg: primaryControl, darkItemSelectedColor: palette.colorTextLightSolid },
      Tag: {
        colorSuccess: palette.green8,
        colorSuccessBg: palette.colorSuccessBg,
        colorWarning: dark ? palette.gold8 : palette.gold9,
        colorWarningBg: palette.colorWarningBg,
        colorError: dark ? palette.red8 : palette.red7,
        colorErrorBg: palette.colorErrorBg,
        colorInfo: dark ? palette.blue8 : palette.blue7,
        colorInfoBg: palette.colorInfoBg,
        ...(!dark
          ? {
              green7: palette.green8,
              gold7: palette.gold9,
              orange7: palette.orange8,
              cyan7: palette.cyan8,
              lime7: palette.lime9,
              yellow7: palette.yellow10,
            }
          : {}),
      },
      Input: { ...inputTypography, inputFontSize: mobile ? 16 : 14 },
      InputNumber: { ...inputTypography, inputFontSize: mobile ? 16 : 14 },
      Select: inputTypography,
      DatePicker: { ...inputTypography, inputFontSize: mobile ? 16 : 14 },
      Form: { itemMarginBottom: 24 },
    },
  };
}

/** Static surfaces use the same algorithm and seed as ConfigProvider. */
export function resolveTheme(mode) {
  return theme.getDesignToken(createTheme(mode));
}
