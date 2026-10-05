// @vitest-environment node
// Static, no DOM: see the admin guard for why.

/**
 * Fails when a portal page or component writes a user-visible string into
 * its markup instead of reaching it through t(). Shares its detector with
 * tools/i18n-scan.mjs, so the scanner prints exactly what this enforces.
 * A genuine false positive is marked on its own line with i18n-ignore.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, it, expect } from 'vitest';
import { detectLiterals, setKnownPhrases } from '../i18n/detectLiterals.js';
import { messages } from '../i18n/messages/index.js';

const SRC = `${globalThis.process.cwd()}/src`;

setKnownPhrases(new Set(Object.values(messages.en)));

function walk(dir, ext, skip, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!skip.includes(name)) walk(path, ext, skip, out);
    } else if (ext.test(name)) {
      out.push(path);
    }
  }
  return out;
}

const rel = (path) => path.slice(SRC.length + 1).split(sep).join('/');
const FILES = walk(SRC, /\.jsx$/, ['test', 'i18n']);

describe('portal i18n', () => {
  it('finds files to check', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('leaves no user-visible literal in a page or component', () => {
    const offenders = [];
    for (const path of FILES) {
      for (const hit of detectLiterals(readFileSync(path, 'utf8'))) {
        offenders.push(`${rel(path)}:${hit.line} [${hit.kind}] ${hit.text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reads the stored locale in exactly one file', () => {
    const everything = walk(SRC, /\.jsx?$/, ['test']);
    const readers = everything
      .filter((path) => readFileSync(path, 'utf8').includes('sentry_portal_locale'))
      .map(rel);
    expect(readers).toEqual(['i18n/translate.js']);
  });

  it('uses every key it defines', () => {
    const code = walk(SRC, /\.jsx?$/, ['test', 'messages'])
      .map((p) => readFileSync(p, 'utf8')).join('\n');
    const prefixes = [...code.matchAll(/`([\w.]+\.)\$\{/g)].map((m) => m[1]);
    const orphans = Object.keys(messages.en).filter((key) => (
      !code.includes(`'${key}'`) && !code.includes(`"${key}"`)
      && !prefixes.some((p) => key.startsWith(p))
    ));
    expect(orphans).toEqual([]);
  });
});
