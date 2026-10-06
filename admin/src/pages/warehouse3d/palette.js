import { useEffect, useState } from 'react';
import { mixHex } from './model.js';

/**
 * Scene colours, read from the theme's CSS custom properties so the 3D
 * view follows light / dark mode like the 2D map does. WebGL cannot use
 * var(--x) directly, hence the read; a MutationObserver on <html>
 * data-theme re-reads after the theme flips.
 */
const FALLBACK = {
  '--map-surface': '#FFFFFF',
  '--map-surface-2': '#F7FAFF',
  '--map-fill': '#EEF2F7',
  '--map-border-strong': '#CBD5E1',
  '--map-muted': '#5E7FA8',
  '--map-accent': '#2563EB',
  '--map-accent-strong': '#1D4ED8',
  '--map-ok': '#16A34A',
  '--map-warn': '#E9B949',
  '--map-bad': '#DC2626',
  '--map-special': '#7C3AED',
};

function readVars() {
  const out = { ...FALLBACK };
  if (typeof window === 'undefined' || !window.getComputedStyle) return out;
  const style = window.getComputedStyle(document.documentElement);
  Object.keys(FALLBACK).forEach((name) => {
    const v = style.getPropertyValue(name).trim();
    if (/^#[0-9a-f]{3,6}$/i.test(v)) out[name] = v;
  });
  return out;
}

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

export function useScenePalette() {
  const [palette, setPalette] = useState(() => paletteFromVars(readVars()));
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const refresh = () => setPalette(paletteFromVars(readVars()));
    refresh();
    const obs = new MutationObserver(refresh);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return palette;
}
