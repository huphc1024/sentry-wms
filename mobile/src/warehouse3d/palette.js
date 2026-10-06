import { mixHex } from './model.js';

/**
 * Scene colours for the mobile 3D view.
 *
 * paletteFromVars is copied unchanged from admin/src/pages/warehouse3d/
 * palette.js so both apps map a bin's colour key to the same colour.
 * The web reads the --map-* values from CSS; the handheld gets them from
 * theme/styles.js (scene3dColors), read once at startup like the rest of
 * the app's theme. Pure: no React Native import, so it is unit-testable.
 */
export function paletteFromVars(v) {
  const ok = v['--map-ok'];
  const warn = v['--map-warn'];
  const bad = v['--map-bad'];
  return {
    background: v['--map-surface-2'],
    floor: v['--map-fill'],
    rack: v['--map-border-strong'],
    rackPost: v['--map-muted'],
    glow: v['--map-accent'],
    selection: v['--map-accent-strong'],
    path: v['--map-special'],
    fallback: v['--map-border-strong'],
    'status-empty': v['--map-surface'],
    'status-occupied': ok,
    'status-expired': warn,
    fill0: v['--map-surface'],
    fill1: ok,
    fill2: mixHex(ok, warn, 0.5),
    fill3: warn,
    fill4: bad,
    'expiry-none': v['--map-border-strong'],
    'expiry-ok': ok,
    'expiry-soon': warn,
    'expiry-expired': bad,
  };
}

/** paletteFromVars plus the mobile-only extras (zone fallback, label chips). */
export function scenePalette(vars) {
  return {
    ...paletteFromVars(vars),
    zoneFallback: vars.zoneFallback,
    labelText: vars.labelText,
    labelBg: vars.labelBg,
    // Picked / shorted stops fade most of the way to the floor.
    done: mixHex(vars['--map-special'], vars['--map-fill'], 0.65),
  };
}

/** Legend rows per colour mode: [palette key, i18n key]. Same buckets as the web. */
export const LEGENDS = {
  status: [
    ['status-empty', 'map3d.statusEmpty'],
    ['status-occupied', 'map3d.statusOccupied'],
    ['status-expired', 'map3d.statusExpiring'],
  ],
  fill: [
    ['fill0', 'map3d.fill0'],
    ['fill1', 'map3d.fill1'],
    ['fill2', 'map3d.fill2'],
    ['fill3', 'map3d.fill3'],
    ['fill4', 'map3d.fill4'],
  ],
  expiry: [
    ['expiry-expired', 'map3d.expiryExpired'],
    ['expiry-soon', 'map3d.expirySoon'],
    ['expiry-ok', 'map3d.expiryOk'],
    ['expiry-none', 'map3d.expiryNone'],
  ],
};

export const MODE_LABELS = {
  status: 'map3d.modeStatus',
  fill: 'map3d.modeFill',
  expiry: 'map3d.modeExpiry',
};
