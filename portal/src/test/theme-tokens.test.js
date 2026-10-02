/**
 * App.css and antdTheme.js describe the same two palettes in two
 * languages, and nothing at runtime forces them to agree: a page styled
 * by hand reads the CSS token, the antd component next to it reads the
 * JS one. Change one and the other keeps rendering the old colour, which
 * shows up as a panel that is almost-but-not-quite the shade of the
 * table inside it -- the kind of thing nobody files a bug about and
 * everybody notices.
 *
 * So the test reads the tokens back out of App.css and compares. App.css
 * is the source; antdTheme.js follows it.
 *
 * It also compares against the admin panel's palette. The two apps are
 * separate deployables and neither imports the other, which is the right
 * boundary -- but it means one brand can end up wearing two shades of
 * copper depending on which app a customer and an operator are looking
 * at, and nothing at runtime would say so.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { LIGHT, DARK } from '../theme/antdTheme.js';

// Read as text rather than imported: vitest hands an imported stylesheet
// to Vite's css plugin, which returns a module, not the source. Reached
// through globalThis so the browser-flavoured eslint config does not
// trip over a bare `process`.
const css = readFileSync(`${globalThis.process.cwd()}/src/App.css`, 'utf8');
const ADMIN_CSS_PATH = `${globalThis.process.cwd()}/../admin/src/App.css`;

/** Pull the custom properties out of one selector's block. */
function tokensOf(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in App.css`);
  const block = css.slice(start, css.indexOf('\n}', start));
  const out = {};
  for (const [, name, value] of block.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    out[name] = value.trim();
  }
  return out;
}

const lightCss = tokensOf(':root');
const darkCss = tokensOf(':root[data-theme="dark"]');

// The JS name on the left, the CSS custom property on the right.
const PAIRS = [
  ['accent', '--accent'],
  ['accentHover', '--accent-hover'],
  ['onAccent', '--on-accent'],
  ['copper', '--copper'],
  ['bg', '--bg'],
  ['panel', '--panel'],
  ['surface', '--surface'],
  ['text', '--text'],
  ['textSecondary', '--text-secondary'],
  ['textTertiary', '--text-tertiary'],
  ['border', '--border'],
  ['borderDark', '--border-dark'],
  ['success', '--success'],
  ['warning', '--warning'],
  ['danger', '--danger'],
  ['info', '--info'],
];

/** Relative luminance, per WCAG. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('theme tokens', () => {
  it.each(PAIRS)('light %s matches %s in App.css', (jsName, cssName) => {
    expect(lightCss[cssName]).toBeDefined();
    expect(LIGHT[jsName].toLowerCase()).toBe(lightCss[cssName].toLowerCase());
  });

  // --copper is the one colour both themes share: it is only ever used
  // on the dark chrome, which does not change between modes.
  const DARK_PAIRS = PAIRS.filter(([jsName]) => jsName !== 'copper');

  it.each(DARK_PAIRS)('dark %s matches %s in App.css', (jsName, cssName) => {
    expect(darkCss[cssName]).toBeDefined();
    expect(DARK[jsName].toLowerCase()).toBe(darkCss[cssName].toLowerCase());
  });

  it('shares the one colour it means to share', () => {
    expect(darkCss['--copper']).toBeUndefined();
    expect(DARK.copper).toBe(LIGHT.copper);
  });

  it('defines a dark value for every colour the light theme has', () => {
    // A token declared only in :root keeps its light value on a dark
    // page, which is how a white panel survives into dark mode.
    const colourish = (v) => /^#[0-9a-fA-F]{3,8}$/.test(v);
    const missing = Object.entries(lightCss)
      .filter(([name, value]) => colourish(value) && !(name in darkCss))
      // Fonts, radii and the two coppers are deliberately shared.
      .filter(([name]) => !['--cream', '--copper'].includes(name))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });
});

describe('theme contrast', () => {
  const AA = 4.5;

  it('keeps body text readable on its own background', () => {
    expect(contrast(LIGHT.text, LIGHT.panel)).toBeGreaterThanOrEqual(AA);
    expect(contrast(LIGHT.text, LIGHT.bg)).toBeGreaterThanOrEqual(AA);
    expect(contrast(DARK.text, DARK.panel)).toBeGreaterThanOrEqual(AA);
    expect(contrast(DARK.text, DARK.bg)).toBeGreaterThanOrEqual(AA);
  });

  it('keeps secondary text readable -- it carries table headers and labels', () => {
    expect(contrast(LIGHT.textSecondary, LIGHT.panel)).toBeGreaterThanOrEqual(AA);
    expect(contrast(DARK.textSecondary, DARK.panel)).toBeGreaterThanOrEqual(AA);
  });

  it('keeps a button label readable on the accent fill', () => {
    // This is why the two modes use different coppers: the lighter one
    // carries only 3.6:1 against white.
    expect(contrast(LIGHT.onAccent, LIGHT.accent)).toBeGreaterThanOrEqual(AA);
    expect(contrast(DARK.onAccent, DARK.accent)).toBeGreaterThanOrEqual(AA);
  });

  it('keeps the status colours readable on every surface they land on', () => {
    // Not just the panel. A status colour is mostly seen inside a tag,
    // on its own tint, and on the fill behind a table header -- and
    // checking only the panel is how a warning at 4.43:1 on its own
    // amber tint went unnoticed until the handheld's palette was tested
    // against the same rule.
    for (const key of ['success', 'warning', 'danger', 'info', 'accent']) {
      for (const surface of ['panel', 'surface', 'bg']) {
        expect(contrast(LIGHT[key], LIGHT[surface]), `light ${key} on ${surface}`)
          .toBeGreaterThanOrEqual(AA);
        expect(contrast(DARK[key], DARK[surface]), `dark ${key} on ${surface}`)
          .toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it('keeps a status colour readable on its own tint', () => {
    for (const key of ['success', 'warning', 'danger', 'info']) {
      const tint = `--${key}-bg`;
      expect(contrast(LIGHT[key], lightCss[tint]), `light ${key}`).toBeGreaterThanOrEqual(AA);
      expect(contrast(DARK[key], darkCss[tint]), `dark ${key}`).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe('one brand across two apps', () => {
  // Skipped rather than failed when the sibling app is not checked out:
  // the portal has to build on its own.
  const adminCss = (() => {
    try { return readFileSync(ADMIN_CSS_PATH, 'utf8'); } catch { return null; }
  })();

  function adminTokens(selector) {
    const start = adminCss.indexOf(`${selector} {`);
    const block = adminCss.slice(start, adminCss.indexOf('\n}', start));
    const out = {};
    for (const [, name, value] of block.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
      out[name] = value.trim();
    }
    return out;
  }

  // Everything the two apps share. The admin panel additionally carries
  // chrome and floor-plan tokens the portal has no use for.
  const SHARED = PAIRS.map(([, cssName]) => cssName);

  it.runIf(adminCss)('matches the admin panel, light', () => {
    const theirs = adminTokens(':root');
    for (const name of SHARED) {
      expect(lightCss[name]?.toLowerCase(), name).toBe(theirs[name]?.toLowerCase());
    }
  });

  it.runIf(adminCss)('matches the admin panel, dark', () => {
    const theirs = adminTokens(':root[data-theme="dark"]');
    for (const name of SHARED.filter((n) => n !== '--copper')) {
      expect(darkCss[name]?.toLowerCase(), name).toBe(theirs[name]?.toLowerCase());
    }
  });
});
