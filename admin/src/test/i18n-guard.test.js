// @vitest-environment node
// This file never touches the DOM. Building a jsdom for it cost about
// eighteen seconds of the suite's wall clock and, on a loaded machine,
// starved the tests that do need one into a timeout.

/**
 * Fails when a converted page still writes a user-visible string into
 * its markup.
 *
 * Every page is converted and the runtime dictionaries (the DOM sweep,
 * translateTree, tx, extraVi) are gone, so this gate is the whole
 * defence: a literal written into a page is shown as written, in both
 * languages.
 *
 * The detector is shared with tools/i18n-scan.mjs on purpose. A scanner
 * that reported a different set from the gate would let a page look
 * finished while the gate stayed red, or — worse — look finished and
 * pass.
 *
 * Static rather than render-based, the same trade the mobile theming
 * gate makes. Rendering forty-nine antd pages in a suite that already
 * needs testTimeout: 20000 would multiply its runtime, and would still
 * only see the branches that happen to render: a literal on an error
 * path or inside a closed modal is invisible to it. Static gives
 * file:line, which is what a burn-down needs.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { detectLiterals, setKnownPhrases } from '../i18n/detectLiterals.js';
import { messages } from '../i18n/messages/index.js';

const SRC = `${globalThis.process.cwd()}/src`;

/** Files allowed to carry literals. Empty: every page and component is converted. */
const UNCONVERTED_COMPONENTS = [];

const exempt = new Set(UNCONVERTED_COMPONENTS);

// A phrase the app can already translate is copy, whatever its
// shape -- that is how 'Qty' and 'UPC' are caught by a test that
// otherwise treats short all-caps strings as codes.
setKnownPhrases(new Set(Object.values(messages.en)));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!['__tests__', 'test', 'i18n'].includes(name)) walk(path, out);
    } else if (name.endsWith('.jsx')) {
      out.push(path);
    }
  }
  return out;
}

/** Path relative to src/, with forward slashes, matching the lists above. */
const rel = (path) => path.slice(SRC.length + 1).split('\\').join('/');

const FILES = walk(SRC);

describe('i18n burn-down', () => {
  it('finds files to check', () => {
    // If the walk breaks, every assertion below passes by checking
    // nothing at all.
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('leaves no user-visible literal in a converted file', () => {
    const offenders = [];
    for (const path of FILES) {
      if (exempt.has(rel(path))) continue;
      for (const hit of detectLiterals(readFileSync(path, 'utf8'))) {
        offenders.push(`${rel(path)}:${hit.line} [${hit.kind}] ${hit.text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('exempts only files that exist', () => {
    const known = new Set(FILES.map(rel));
    const stale = [...exempt].filter((f) => !known.has(f));
    expect(stale).toEqual([]);
  });

  it('reads the stored locale in exactly one file', () => {
    // How the app ended up with five translation mechanisms: anything
    // that needed the locale outside React read the storage key itself
    // and grew its own dictionary beside it. ErrorBoundary and
    // friendlyError each did. Naming the key in one module is what
    // stops the sixth.
    // Its own walk: the one above skips src/i18n and takes only .jsx,
    // and this has to see every module in the app.
    const everything = (dir, out = []) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== '__tests__' && name !== 'test') everything(path, out);
        } else if (/\.jsx?$/.test(name)) {
          out.push(path);
        }
      }
      return out;
    };
    const readers = everything(SRC)
      .filter((path) => readFileSync(path, 'utf8').includes('sentry_admin_locale'))
      .map(rel);
    expect(readers).toEqual(['i18n/translate.js']);
  });

  it('exempts only files that still need it', () => {
    // The assertion that makes the burn-down terminate. Without it, an
    // entry for an already-clean page lingers forever and the list
    // stops meaning anything. A page going clean turns this red until
    // somebody removes its entry.
    const pointless = [...exempt].filter((f) => {
      const path = join(SRC, f);
      try {
        return detectLiterals(readFileSync(path, 'utf8')).length === 0;
      } catch {
        return false;
      }
    });
    expect(pointless).toEqual([]);
  });
});
