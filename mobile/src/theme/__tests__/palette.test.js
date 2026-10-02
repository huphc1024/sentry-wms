/**
 * The mobile palette is the third copy of one brand.
 *
 * The two web apps check themselves against each other; this does the
 * same from the other side of the repo. Nothing at runtime connects a
 * React Native StyleSheet to a CSS custom property, so without a test
 * the handheld quietly keeps whatever shade of copper it was born with
 * while the panel a supervisor is looking at moves on.
 *
 * It also guards the thing that makes any of this work: that screens
 * read colours from the palette rather than writing their own. Two
 * exceptions are deliberate and named below.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = `${globalThis.process.cwd()}/src`;
const ADMIN_CSS = `${globalThis.process.cwd()}/../admin/src/App.css`;

/**
 * Read the palettes out of the file as text rather than importing it.
 * styles.js pulls in react-native, whose source is Flow, which the test
 * runner cannot parse -- and a palette is a flat list of literals, so
 * there is nothing to execute.
 */
const source = readFileSync(`${ROOT}/theme/styles.js`, 'utf8');

function paletteNamed(name) {
  const start = source.indexOf(`const ${name} = {`);
  if (start === -1) throw new Error(`no ${name} palette in styles.js`);
  const block = source.slice(start, source.indexOf('\n};', start));
  const out = {};
  for (const [, key, value] of block.matchAll(/^\s*(\w+):\s*'([^']+)',/gm)) {
    out[key] = value;
  }
  return out;
}

const colors = paletteNamed('LIGHT');
const dark = paletteNamed('DARK');

function adminTokens(selector = ':root') {
  const css = readFileSync(ADMIN_CSS, 'utf8');
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf('\n}', start));
  const out = {};
  for (const [, name, value] of block.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    out[name] = value.trim().toLowerCase();
  }
  return out;
}

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

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__') walk(path, out);
    } else if (name.endsWith('.js') || name.endsWith('.jsx')) {
      out.push(path);
    }
  }
  return out;
}

describe('one brand across three apps', () => {
  const admin = (() => {
    try { return adminTokens(); } catch { return null; }
  })();

  // Skipped rather than failed when the web app is not checked out: the
  // handheld has to build on its own.
  const PAIRS = [
    ['accent', '--accent'],
    ['accentHover', '--accent-hover'],
    ['onAccent', '--on-accent'],
    ['copper', '--copper'],
    ['canvas', '--bg'],
    ['background', '--panel'],
    ['cardBg', '--surface'],
    ['textPrimary', '--text'],
    ['textSecondary', '--text-secondary'],
    ['textPlaceholder', '--text-tertiary'],
    ['border', '--border'],
    ['inputBorder', '--border-dark'],
    ['success', '--success'],
    ['successBg', '--success-bg'],
    ['warning', '--warning'],
    ['warningBg', '--warning-bg'],
    ['danger', '--danger'],
    ['dangerBg', '--danger-bg'],
    ['info', '--info'],
    ['infoBg', '--info-bg'],
  ];

  const adminDark = (() => {
    try { return adminTokens(':root[data-theme="dark"]'); } catch { return null; }
  })();

  it.runIf(admin).each(PAIRS)('light %s matches the admin panel\'s %s', (name, token) => {
    expect(admin[token]).toBeDefined();
    expect(colors[name].toLowerCase()).toBe(admin[token]);
  });

  // --copper is the one colour the web keeps identical across modes, so
  // it has no entry in the dark block to compare against.
  it.runIf(adminDark).each(PAIRS.filter(([name]) => name !== 'copper'))(
    'dark %s matches the admin panel\'s %s',
    (name, token) => {
      expect(adminDark[token]).toBeDefined();
      expect(dark[name].toLowerCase()).toBe(adminDark[token]);
    }
  );
});

describe.each([['light', colors], ['dark', dark]])('%s palette contrast', (_mode, c) => {
  const AA = 4.5;

  it('keeps body and secondary text readable on every surface', () => {
    for (const bg of [c.background, c.cardBg, c.canvas]) {
      expect(contrast(c.textPrimary, bg)).toBeGreaterThanOrEqual(AA);
      expect(contrast(c.textSecondary, bg)).toBeGreaterThanOrEqual(AA);
    }
  });

  it('keeps a button label readable on the accent fill', () => {
    expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(AA);
  });

  it('keeps every status colour readable on its own tint', () => {
    const pairs = [
      ['success', 'successBg'], ['warning', 'warningBg'],
      ['danger', 'dangerBg'], ['info', 'infoBg'], ['accent', 'accentBg'],
    ];
    for (const [fg, bg] of pairs) {
      expect(contrast(c[fg], c[bg]), fg).toBeGreaterThanOrEqual(AA);
    }
  });

  it('keeps every status colour readable on the surfaces behind it', () => {
    // A status colour is read on a card, on the screen behind the card,
    // and inside its own tint. Checking one of the three is how the
    // warning colour got to production at 4.43:1 on amber.
    for (const key of ['success', 'warning', 'danger', 'info', 'accent']) {
      for (const bg of ['background', 'cardBg', 'canvas']) {
        expect(contrast(c[key], c[bg]), `${key} on ${bg}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });
});

describe('the floor plan has both ramps', () => {
  // It draws in blue-grey rather than the brand palette, so it is not
  // covered by the checks above -- but it is the screen a picker opens
  // in a dim aisle, and a light drawing there is the worst place for one.
  const light = paletteNamed('MAP_LIGHT');
  const dark2 = paletteNamed('MAP_DARK');

  it('defines the same keys in both', () => {
    expect(Object.keys(dark2).sort()).toEqual(Object.keys(light).sort());
  });

  it('keeps the route and walkway lines visible on their own fills', () => {
    for (const [ramp, name] of [[light, 'light'], [dark2, 'dark']]) {
      for (const key of ['route', 'walkway']) {
        expect(contrast(ramp[key], ramp.fill), `${name} ${key}`).toBeGreaterThanOrEqual(3);
        expect(contrast(ramp[key], ramp.surface), `${name} ${key}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('no colours outside the palette', () => {
  // A camera viewfinder is black whatever the brand, and the floor plan
  // is a technical drawing with its own blue-grey ramp -- neither is a
  // brand surface, so neither is forced through these tokens.
  const ALLOWED = new Set([
    'styles.js',
    'BarcodeScannerModal.js',
    'ExpiryOcrModal.js',
    'WarehouseFloorPlan.js',
  ]);

  it('leaves no literal colour in a screen or component', () => {
    const offenders = [];
    for (const file of walk(ROOT)) {
      const name = file.split(/[\\/]/).pop();
      if (ALLOWED.has(name)) continue;
      const source = readFileSync(file, 'utf8');
      for (const line of source.split('\n')) {
        // `(#295)` in a comment is an issue number, not a colour --
        // including in a JSX comment, which opens with a brace.
        if (/^\s*(\{\/\*|\/\/|\*|\/\*)/.test(line)) continue;
        const hits = line.match(/(?<!&)#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g);
        if (hits) offenders.push(`${name}: ${line.trim().slice(0, 70)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
