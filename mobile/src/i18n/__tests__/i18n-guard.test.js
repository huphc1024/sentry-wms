// @vitest-environment node

/**
 * Fails when a screen or component writes a user-visible string into its
 * markup instead of reaching it through t().
 *
 * Static for the same reason the theming gate is: there is no React Native
 * runtime in this suite, so nothing can be rendered. The detector is the
 * one `tools/i18n-scan.mjs` prints from, so the scanner and this gate can
 * never disagree about what counts as a literal.
 *
 * A genuine false positive (an enum, a header name, a URL path) is marked
 * on its own line with `// i18n-ignore`, so each exception shows up in
 * review rather than opting a whole file out.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { detectLiterals, setKnownPhrases } from '../detectLiterals.js';
import { messages } from '../messages/index.js';

const SRC = `${globalThis.process.cwd()}/src`;

setKnownPhrases(new Set(Object.values(messages.en)));

// src/native is the Chainway scanner bridge: no UI copy. i18n holds the
// tables themselves, which are all literals by definition.
const SKIP_DIRS = new Set(['__tests__', 'i18n', 'native']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(path, out);
    } else if (name.endsWith('.js')) {
      out.push(path);
    }
  }
  return out;
}

const rel = (path) => path.slice(SRC.length + 1).split('\\').join('/');
const FILES = walk(SRC);

describe('mobile i18n', () => {
  it('finds files to check', () => {
    // If the walk breaks, the assertion below passes by checking nothing.
    expect(FILES.length).toBeGreaterThan(30);
  });

  it('leaves no user-visible literal in a screen or component', () => {
    const offenders = [];
    for (const path of FILES) {
      for (const hit of detectLiterals(readFileSync(path, 'utf8'))) {
        offenders.push(`${rel(path)}:${hit.line} [${hit.kind}] ${hit.text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reads the stored locale in exactly one file', () => {
    // The second reader is how an app ends up with two languages on one
    // screen: it resolves the locale at a different moment than the
    // provider does.
    const everything = (dir, out = []) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== '__tests__') everything(path, out);
        } else if (name.endsWith('.js')) {
          out.push(path);
        }
      }
      return out;
    };
    const readers = everything(SRC)
      .filter((path) => readFileSync(path, 'utf8').includes('sentry_mobile_locale'))
      .map(rel);
    expect(readers).toEqual(['i18n/translate.js']);
  });

  it('uses every key it defines', () => {
    const code = FILES.map((p) => readFileSync(p, 'utf8')).join('\n');
    const prefixes = [...code.matchAll(/`([\w.]+\.)\$\{/g)].map((m) => m[1]);
    const orphans = Object.keys(messages.en).filter((key) => (
      !code.includes(`'${key}'`) && !code.includes(`"${key}"`)
      && !prefixes.some((p) => key.startsWith(p))
    ));
    expect(orphans).toEqual([]);
  });
});
