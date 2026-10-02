import { Appearance, Platform, StyleSheet } from 'react-native';

/**
 * One palette, shared with the two web apps, in light and dark.
 *
 * The values mirror admin/src/App.css and portal/src/App.css: copper
 * accent on neutral stone, and brick red reserved for one meaning --
 * destructive or failed. The app used to use brick as its accent, which
 * made every primary button on the floor look like an error state.
 *
 * ── Why the theme is read once, at startup ──────────────────
 *
 * Every screen in this app builds its styles with StyleSheet.create at
 * module scope, which resolves the colours when the module is imported
 * and never again. Reacting to a theme change while the app is running
 * would mean converting all twenty-nine of those call sites to build
 * their styles during render, behind a context and a hook.
 *
 * That is a wide, mechanical change to an app people use on a warehouse
 * floor, and it buys one thing: the screen repainting the instant the
 * device theme flips. On a handheld, where the theme is set once by
 * whoever provisions the device and not by the picker mid-shift, that is
 * not worth the blast radius. So the scheme is read here, once, and the
 * app picks up a change on its next launch.
 *
 * If live switching is ever actually wanted -- a toggle in the app, say
 * -- this is the line to come back to, and the refactor above is what it
 * costs.
 */

const LIGHT = {
  // Brand
  accent: '#9C5718',
  accentHover: '#8F4F18',
  onAccent: '#FFFFFF',
  accentBg: '#F7EFE6',
  copper: '#C4722A',
  cream: '#FCF4E3',

  // Surfaces
  background: '#FFFFFF',
  canvas: '#F6F6F5',
  cardBg: '#F1F1EF',
  cardBorder: '#E3E2DF',
  inputBg: '#F1F1EF',
  inputBorder: '#CFCDC8',

  // Text
  textPrimary: '#1C1B19',
  textSecondary: '#6E6B66',
  textMuted: '#6E6B66',
  textPlaceholder: '#9C9892',

  // Status
  success: '#1F6F3C',
  successBg: '#E7F3EB',
  warning: '#806316',
  warningBg: '#FBF3DE',
  danger: '#8E2715',
  dangerBg: '#FAE7E4',
  info: '#1E5F8A',
  infoBg: '#E4EFF6',

  // Utility
  border: '#E3E2DF',
  overlay: 'rgba(0, 0, 0, 0.45)',
  grayAccent: '#9C9892',
};

const DARK = {
  // A lighter copper than light mode uses, because here it is read
  // against a dark panel rather than white.
  accent: '#D6883F',
  accentHover: '#E09A55',
  // On a copper fill the label goes dark, not white.
  onAccent: '#1A1A19',
  accentBg: '#2A2118',
  copper: '#C4722A',
  cream: '#FCF4E3',

  background: '#232322',
  canvas: '#1A1A19',
  cardBg: '#2B2B29',
  cardBorder: '#35342F',
  inputBg: '#2B2B29',
  inputBorder: '#47453F',

  textPrimary: '#EDEBE7',
  textSecondary: '#A8A49D',
  textMuted: '#A8A49D',
  textPlaceholder: '#7A766F',

  success: '#5FBF7A',
  successBg: '#1B2E20',
  warning: '#D4AA3A',
  warningBg: '#2E2715',
  danger: '#E57A66',
  dangerBg: '#331C18',
  info: '#5FA8D8',
  infoBg: '#16262F',

  border: '#35342F',
  overlay: 'rgba(0, 0, 0, 0.6)',
  grayAccent: '#7A766F',
};

/**
 * Read at module scope, which is the earliest point the stylesheets need
 * it -- and the riskiest place to touch a native module, because a throw
 * here takes the whole app down before the first screen renders rather
 * than breaking one colour. Hence the guard: any failure, and any device
 * that reports no preference, reads as light. Light is the safe default
 * for a screen used under warehouse lighting.
 */
function detectScheme() {
  try {
    return Appearance?.getColorScheme?.() === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export const scheme = detectScheme();

export const palettes = { light: LIGHT, dark: DARK };

export const colors = palettes[scheme];

/**
 * The warehouse floor plan draws in its own blue-grey ramp rather than
 * the brand palette -- it is a technical drawing, and flattening it into
 * the app's neutrals would cost the layering that separates a rack from
 * an aisle. It still needs a dark set, or the one screen a picker opens
 * in a dim aisle is the one that blinds them.
 */
const MAP_LIGHT = {
  surface: '#FAFAFA',
  fill: '#EEF2FF',
  border: '#CBD5E1',
  borderStrong: '#475569',
  muted: '#94A3B8',
  route: '#2563EB',
  walkway: '#0F8238',
  // Translucent so the grid shows through; the plan is drawn in layers.
  zoneFill: 'rgba(255, 255, 255, 0.55)',
  gridFill: 'rgba(255, 255, 255, 0.92)',
  highlightFill: 'rgba(156, 87, 24, 0.14)',
};

const MAP_DARK = {
  surface: '#232322',
  fill: '#262A33',
  border: '#3A3934',
  borderStrong: '#6B6860',
  muted: '#7A766F',
  // Lifted clear of the dark fills; the light-mode pair is under 3:1 on
  // them.
  route: '#6BA8F0',
  walkway: '#5FBF7A',
  zoneFill: 'rgba(255, 255, 255, 0.05)',
  gridFill: 'rgba(255, 255, 255, 0.04)',
  highlightFill: 'rgba(214, 136, 63, 0.22)',
};

export const mapColors = { light: MAP_LIGHT, dark: MAP_DARK }[scheme];

export const radii = {
  card: 12,
  input: 12,
  button: 12,
  badge: 6,
  small: 8,
  heroCard: 12,
};

export const spacing = {
  screenPadding: 16,
  cardGap: 8,
  sectionGap: 12,
  cardPadding: 14,
  bottomBarPadding: 16,
};

export const fonts = {
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), // i18n-ignore
};

// ── Shared screen layout ─────────────────────────────────────
export const screenStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12,
  },
  backBtn: { padding: 4, minWidth: 32, minHeight: 48, justifyContent: 'center' },
  backText: { fontSize: 22, color: colors.textPrimary },
  headerTitle: {
    fontFamily: fonts.mono, fontSize: 16, fontWeight: '700',
    color: colors.textPrimary, letterSpacing: 0.5, textTransform: 'uppercase',
  },
  content: { flex: 1 },
  contentInner: { padding: 16 },
  bottomBar: { padding: 16, borderTopWidth: 1, borderTopColor: colors.cardBorder, gap: 8, flexDirection: 'row' },
  menuBtn: { padding: 4, minWidth: 32, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  menuIcon: { fontSize: 20, color: colors.textPrimary, fontWeight: '700' },
});

// ── Shared buttons ───────────────────────────────────────────
export const buttonStyles = StyleSheet.create({
  buttonPrimary: {
    backgroundColor: colors.accent, borderRadius: radii.button,
    paddingVertical: 14, alignItems: 'center', minHeight: 48,
  },
  buttonPrimaryText: {
    color: colors.cream, fontFamily: fonts.mono, fontSize: 14,
    fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', textAlign: 'center',
  },
  buttonSecondary: {
    backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.cardBorder,
    borderRadius: radii.button, paddingVertical: 14, alignItems: 'center', minHeight: 48,
  },
  buttonSecondaryText: {
    color: colors.textSecondary, fontFamily: fonts.mono, fontSize: 14,
    fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', textAlign: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
});

// ── Shared modals ────────────────────────────────────────────
export const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: colors.overlay,
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  card: {
    backgroundColor: colors.background, borderRadius: radii.card, padding: 24,
    width: '100%', maxWidth: 320, borderWidth: 1, borderColor: colors.cardBorder,
  },
  title: {
    fontFamily: fonts.mono, fontSize: 16, fontWeight: '700',
    color: colors.textPrimary, marginBottom: 8,
  },
  subtitle: { fontSize: 13, color: colors.textMuted, marginBottom: 16 },
  divider: { height: 1, backgroundColor: colors.cardBorder, marginVertical: 16 },
  body: { fontSize: 14, color: colors.textPrimary, marginBottom: 20 },
  actions: { gap: 8, flexDirection: 'row' },
});

// ── Shared list row patterns ─────────────────────────────────
export const listStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: radii.card, padding: 12, marginBottom: 8, minHeight: 48,
  },
  removeBtn: { padding: 8, minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontFamily: fonts.mono, fontSize: 14, fontWeight: '700', color: colors.textMuted },
  sku: { fontFamily: fonts.mono, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  itemName: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  label: {
    fontFamily: fonts.mono, fontSize: 10, fontWeight: '600',
    color: colors.textMuted, letterSpacing: 0.3, marginBottom: 2,
    textTransform: 'uppercase',
  },
  qtyInput: {
    fontFamily: fonts.mono, fontSize: 18, fontWeight: '700', color: colors.textPrimary,
    backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder,
    borderRadius: radii.input, paddingHorizontal: 12, paddingVertical: 8,
    width: 80, textAlign: 'center', minHeight: 48,
  },
});

// ── Shared done / success section ────────────────────────────
export const doneStyles = StyleSheet.create({
  section: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  check: { fontSize: 64, color: colors.success, marginBottom: 16 },
  title: {
    fontFamily: fonts.mono, fontSize: 22, fontWeight: '700',
    color: colors.textPrimary, marginBottom: 8,
  },
  detail: { fontSize: 15, color: colors.textMuted, marginBottom: 32 },
});

export default StyleSheet.create({
  // ── Layout ──────────────────────────────────────────────
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    flex: 1,
    padding: spacing.screenPadding,
  },

  // ── Header ──────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 12,
  },
  headerTitle: {
    fontFamily: fonts.mono,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  headerBack: {
    paddingRight: 12,
    paddingVertical: 4,
  },
  headerBackText: {
    fontSize: 22,
    color: colors.textPrimary,
  },

  // ── Cards ───────────────────────────────────────────────
  card: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.card,
    padding: spacing.cardPadding,
    marginBottom: spacing.sectionGap,
  },
  cardRed: {
    backgroundColor: colors.cardBg,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: radii.card,
    padding: spacing.cardPadding,
    marginBottom: spacing.sectionGap,
  },

  // ── Buttons ─────────────────────────────────────────────
  buttonPrimary: {
    backgroundColor: colors.accent,
    borderRadius: radii.button,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonPrimaryText: {
    color: colors.cream,
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  buttonSecondary: {
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.cardBorder,
    borderRadius: radii.button,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonSecondaryText: {
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },

  // ── Scan Input ──────────────────────────────────────────
  scanInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: radii.input,
    paddingHorizontal: 12,
    minHeight: 44,
    marginBottom: 16,
  },
  scanInputField: {
    flex: 1,
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.textPrimary,
    letterSpacing: 1,
    paddingVertical: 10,
  },
  scanInputDisabled: {
    backgroundColor: '#f0ede6',
    borderColor: colors.cardBorder,
  },

  // ── Badges ──────────────────────────────────────────────
  badge: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  badgeCopper: {
    backgroundColor: colors.copper,
  },
  badgeText: {
    color: colors.cream,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: '700',
  },

  // ── Typography ──────────────────────────────────────────
  monoText: {
    fontFamily: fonts.mono,
  },
  sku: {
    fontFamily: fonts.mono,
    fontSize: 14,
    color: colors.textPrimary,
  },
  binCode: {
    fontFamily: fonts.mono,
    fontSize: 30,
    fontWeight: '700',
    color: colors.accent,
  },
  qty: {
    fontFamily: fonts.mono,
    fontSize: 28,
    fontWeight: '700',
    color: colors.accent,
  },
  label: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  itemName: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.copper,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  muted: {
    fontSize: 12,
    color: colors.textMuted,
  },

  // ── Form Inputs ─────────────────────────────────────────
  textInput: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radii.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.inputBg,
    minHeight: 48,
  },
  quantityInput: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radii.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.mono,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    backgroundColor: colors.inputBg,
    minHeight: 48,
    textAlign: 'center',
    width: 80,
  },

  // ── List Items ──────────────────────────────────────────
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.card,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    minHeight: 48,
  },

  // ── Misc ────────────────────────────────────────────────
  divider: {
    height: 1,
    backgroundColor: colors.cardBorder,
    marginVertical: 12,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spaceBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
