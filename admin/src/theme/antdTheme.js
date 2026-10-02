import { theme as antdAlgorithms } from 'antd';

/**
 * Ant Design theme for the Sơn Lộc admin panel, in both modes.
 *
 * The palettes here are not chosen independently: every value mirrors a
 * token in App.css, so a migrated page and a hand-written one sit side by
 * side without a seam. `App.css` is the source; this file follows it.
 * They are separate files that must agree, which is exactly the kind of
 * pair that drifts -- so a test reads the tokens back out of App.css and
 * fails if the two ever disagree.
 *
 * The accent is copper, and it is a different copper per mode on purpose:
 * light mode needs a darker one to carry white button text at 4.5:1,
 * dark mode can use the lighter one because it sits on a dark panel. In
 * dark mode the label on an accent fill goes dark rather than white, for
 * the same reason.
 *
 * Per-component overrides belong in `components` below, never as inline
 * styles on a page: inline styles are what this migration exists to
 * delete.
 */

export const LIGHT = {
  accent: '#9C5718',
  accentHover: '#8F4F18',
  onAccent: '#FFFFFF',
  copper: '#C4722A',
  bg: '#F6F6F5',
  panel: '#FFFFFF',
  surface: '#F1F1EF',
  text: '#1C1B19',
  textSecondary: '#6E6B66',
  textTertiary: '#9C9892',
  border: '#E3E2DF',
  borderDark: '#CFCDC8',
  success: '#1F6F3C',
  warning: '#806316',
  danger: '#8E2715',
  info: '#1E5F8A',
};

export const DARK = {
  accent: '#D6883F',
  accentHover: '#E09A55',
  onAccent: '#1A1A19',
  copper: '#C4722A',
  bg: '#1A1A19',
  panel: '#232322',
  surface: '#2B2B29',
  text: '#EDEBE7',
  textSecondary: '#A8A49D',
  textTertiary: '#7A766F',
  border: '#35342F',
  borderDark: '#47453F',
  success: '#5FBF7A',
  warning: '#D4AA3A',
  danger: '#E57A66',
  info: '#5FA8D8',
};

export const FONTS = {
  sans: "'Instrument Sans', 'Helvetica Neue', sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', monospace",
};

/** Kept so existing imports of `BRAND` keep resolving to the light palette. */
export const BRAND = { ...LIGHT, white: LIGHT.panel, cream: '#FCF4E3', ...FONTS };

export function buildAntdTheme(mode = 'light') {
  const isDark = mode === 'dark';
  const c = isDark ? DARK : LIGHT;

  return {
    // The algorithm is what teaches antd to derive its own greys -- the
    // hovers, the dividers, the shades inside components this file never
    // names -- from a dark base instead of a light one.
    algorithm: isDark ? antdAlgorithms.darkAlgorithm : antdAlgorithms.defaultAlgorithm,
    token: {
      colorPrimary: c.accent,
      colorPrimaryHover: c.accentHover,
      colorLink: c.accent,
      colorSuccess: c.success,
      colorWarning: c.warning,
      colorError: c.danger,
      colorInfo: c.info,

      colorText: c.text,
      colorTextSecondary: c.textSecondary,
      colorTextTertiary: c.textTertiary,
      // Pinned rather than left to antd's derivation, which works from the
      // base palette this theme has already overridden. They are the same
      // values App.css gives a disabled .btn, so a greyed-out <Button> and
      // a greyed-out .btn look alike -- and a disabled control is visibly
      // disabled before anyone clicks it.
      // Empty-state text, form hints -- prose antd renders on the app's
      // behalf. Left to antd it lands on the disabled grey, which is too
      // faint to read a sentence in.
      colorTextDescription: c.textSecondary,
      colorTextDisabled: c.textTertiary,
      colorBgContainerDisabled: c.surface,
      colorBorder: c.borderDark,
      colorBorderSecondary: c.border,
      colorBgBase: c.panel,
      colorBgLayout: c.bg,
      colorBgContainer: c.panel,
      colorBgElevated: c.panel,

      fontFamily: FONTS.sans,
      fontFamilyCode: FONTS.mono,
      fontSize: 14,

      // The existing UI is square-ish and dense; antd's default radius
      // and roomier spacing would make migrated pages read as a different
      // product sitting next to the old ones.
      borderRadius: 6,
      borderRadiusLG: 8,
      borderRadiusSM: 4,
      wireframe: false,
    },
    components: {
      // A warehouse operator scans a table for one row among fifty, so the
      // table stays tight: antd's default padding costs about three rows
      // per screen on a laptop.
      Table: {
        headerBg: c.surface,
        headerColor: c.textSecondary,
        headerSplitColor: c.border,
        borderColor: c.border,
        rowHoverBg: c.surface,
        cellPaddingBlock: 10,
        cellPaddingInline: 12,
        headerBorderRadius: 6,
        // antd tints the footer band grey by default, which makes a normal
        // button sitting in it (the CSV export) read as disabled.
        footerBg: c.panel,
        footerColor: c.textSecondary,
      },
      Button: {
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        fontWeight: 600,
        primaryColor: c.onAccent,
      },
      Modal: {
        titleFontSize: 17,
        headerBg: c.panel,
        contentBg: c.panel,
      },
      Input: { paddingBlock: 6 },
      Select: { optionSelectedBg: c.surface },
      Tag: { defaultBg: c.surface, defaultColor: c.textSecondary },
      Form: { labelColor: c.textSecondary, labelFontSize: 12, itemMarginBottom: 16 },
    },
  };
}

export const antdTheme = buildAntdTheme('light');

export default antdTheme;
