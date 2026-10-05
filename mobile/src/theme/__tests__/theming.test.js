/**
 * Source-level gate for how the handheld picks its theme.
 *
 * There is no React Native runtime here (see
 * src/auth/__tests__/forcedChangePersistence.test.js for why), so this
 * cannot render a screen and look at it. What it can do is hold the two
 * invariants the design rests on, both of which are easy to break by
 * accident and invisible until someone opens the app on a dark device:
 *
 *   1. The scheme is read exactly once, in styles.js. Every screen builds
 *      its styles with StyleSheet.create at module scope, so a second
 *      reader somewhere else would be resolved at a different moment and
 *      could disagree.
 *   2. No screen or component writes a colour of its own. The palette is
 *      the only thing that changes between themes; a literal does not,
 *      and turns into a white card on a dark screen.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = `${globalThis.process.cwd()}/src`;
const STYLES = join(ROOT, 'theme', 'styles.js');

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

describe('the device theme is read once', () => {
  it('is read in styles.js and nowhere else', () => {
    const readers = walk(ROOT).filter((path) => {
      const source = readFileSync(path, 'utf8');
      return /getColorScheme|useColorScheme/.test(source);
    });
    expect(readers).toEqual([STYLES]);
  });

  it('falls back to light, and survives the native module throwing', () => {
    // Android can answer null before the native module is ready, and a
    // screen that defaults to dark under warehouse lighting is worse
    // than one that defaults to light on a dark-themed device. The throw
    // matters more: this runs at module scope, so an exception here
    // takes the app down before the first screen renders.
    const source = readFileSync(STYLES, 'utf8');
    expect(source).toMatch(/Appearance\?\.getColorScheme\?\.\(\)\s*===\s*'dark'/);
    expect(source).toMatch(/catch \{\s*return 'light';/);
  });

  it('exports both palettes, so a caller cannot get only one', () => {
    const source = readFileSync(STYLES, 'utf8');
    expect(source).toMatch(/export const palettes = \{ light: LIGHT, dark: DARK \}/);
    expect(source).toMatch(/export const colors = palettes\[scheme\]/);
  });
});

describe('screens take their colours from the palette', () => {
  // A camera viewfinder is black whatever the theme, and the floor plan
  // keeps its own blue-grey ramp -- which styles.js now also supplies in
  // two versions, so the plan reads mapColors rather than literals.
  const ALLOWED = new Set(['styles.js', 'BarcodeScannerModal.js', 'ExpiryOcrModal.js']);

  it('leaves no literal colour in a screen or component', () => {
    const offenders = [];
    for (const file of walk(ROOT)) {
      const name = file.split(/[\\/]/).pop();
      if (ALLOWED.has(name)) continue;
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        // `(#295)` in a comment is an issue number, not a colour.
        if (/^\s*(\{\/\*|\/\/|\*|\/\*)/.test(line)) continue;
        // rgba() counts too. A translucent white is invisible to a hex
        // search and is exactly what a light drawing leaves behind on a
        // dark screen -- the floor plan had two of them.
        const literal = /(?<!&)#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/.test(line)
          || /\brgba?\(/.test(line);
        if (literal) {
          offenders.push(`${name}: ${line.trim().slice(0, 70)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the viewfinder chrome out of the palette on purpose', () => {
    // Not an oversight: these two draw over a live camera feed, where
    // black is the right background in either theme. Asserted so that
    // removing the exemption is a decision rather than a surprise.
    for (const name of ['BarcodeScannerModal.js', 'ExpiryOcrModal.js']) {
      const file = walk(ROOT).find((p) => p.endsWith(name));
      expect(readFileSync(file, 'utf8')).toMatch(/#000|#111/);
    }
  });
});

describe('what the screens actually pair', () => {
  /**
   * The palette test proves the tokens are sound; it cannot know how a
   * screen combines them. This walks every style object that sets both a
   * background and a text colour and checks the pair in both palettes --
   * a card that reads fine in light and turns muddy in dark would show
   * up here rather than on a night shift.
   *
   * It is deliberately narrow: only pairs written in the same style
   * object are visible to it. A container styled in one object and its
   * text in another is still a device's job to catch.
   */
  function palette(name) {
    const source = readFileSync(STYLES, 'utf8');
    const start = source.indexOf(`const ${name} = {`);
    const block = source.slice(start, source.indexOf('\n};', start));
    return Object.fromEntries([...block.matchAll(/^\s*(\w+):\s*'([^']+)',/gm)]
      .map(([, key, value]) => [key, value]));
  }

  function luminance(hex) {
    const h = hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  const palettes = { light: palette('LIGHT'), dark: palette('DARK') };

  function pairs() {
    const out = [];
    for (const file of walk(ROOT)) {
      const name = file.split(/[\\/]/).pop();
      for (const blob of readFileSync(file, 'utf8').match(/\{[^{}]*\}/g) || []) {
        const bg = blob.match(/backgroundColor:\s*colors\.(\w+)/);
        const fg = blob.match(/(?<!background)[\s,{]color:\s*colors\.(\w+)/);
        if (bg && fg) out.push({ file: name, bg: bg[1], fg: fg[1] });
      }
    }
    return out;
  }

  it('finds pairs to check at all', () => {
    // Guards the regex above: if it silently stops matching, the suite
    // would go green by checking nothing.
    expect(pairs().length).toBeGreaterThan(5);
  });

  it('keeps every pair readable in both palettes', () => {
    const bad = [];
    for (const { file, bg, fg } of pairs()) {
      for (const [mode, c] of Object.entries(palettes)) {
        if (!(bg in c) || !(fg in c)) continue;
        const ratio = contrast(c[fg], c[bg]);
        if (ratio < 4.5) bad.push(`${mode} ${file}: ${fg} on ${bg} = ${ratio.toFixed(2)}`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});
