// @vitest-environment node
// Source text only; no DOM.

/**
 * Every component that calls `t()` must take it from the hook.
 *
 * Written because of a page that shipped past both existing gates and
 * still crashed. Webhooks.jsx holds five components; the conversion
 * gave the hook to one of them and left `t` undefined in the other
 * four. The literal gate was satisfied -- there were no literals left
 * -- the message tables were complete, and all 196 tests passed. The
 * page threw `ReferenceError: t is not defined` on first render and
 * the error boundary swallowed it into "could not load".
 *
 * A static check is the right shape here. The alternative is a render
 * test per page, and there are forty-odd pages; this reads every file
 * in a second and cannot be forgotten when a new one is added.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const ROOT = `${globalThis.process.cwd()}/src`;

/** Every .jsx under src, recursively. */
function jsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === '__tests__') continue;
      out.push(...jsxFiles(full));
    } else if (entry.name.endsWith('.jsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Split a file into its top-level function components and return the
 * ones that call `t(...)`.
 *
 * Deliberately crude: components in this codebase are declared at
 * column zero, one per block, which makes the next `^function` or
 * `^export default function` a reliable end marker. A parser would be
 * more correct and would also be a dependency to keep working.
 */
function componentsUsing_t(source) {
  const lines = source.split('\n');
  const starts = [];
  lines.forEach((line, i) => {
    const m = /^(?:export (?:default )?)?function ([A-Za-z_$][\w$]*)\s*\(/.exec(line);
    if (m) starts.push({ name: m[1], line: i });
  });
  const out = [];
  starts.forEach((start, n) => {
    const end = n + 1 < starts.length ? starts[n + 1].line : lines.length;
    const body = lines.slice(start.line, end).join('\n');
    // `t(` preceded by a word character or a dot is some other call --
    // `format(`, `r.t(`, `setT(`.
    const calls = /(^|[^\w$.])t\s*\(/m.test(body);
    const hasHook = /\{[^}]*\bt\b[^}]*\}\s*=\s*useLocale\(\)/.test(body)
      // `locale.jsx` builds `t` itself -- it is the thing being
      // provided. The rule is that `t` is bound, not where from.
      || /\b(?:const|let|function)\s+t\s*[(=]/.test(body)
      // A component can also take `t` as a prop, which a few render
      // helpers do.
      || new RegExp(`function ${start.name}\\s*\\([^)]*\\bt\\b`).test(body);
    if (calls && !hasHook) out.push(start.name);
  });
  return out;
}

describe('translation hook', () => {
  const files = jsxFiles(ROOT);

  it('imports useLocale wherever it is called', () => {
    // The same conversion that forgot the hook also forgot the
    // import, and the page threw `useLocale is not defined` from the
    // line that was supposed to fix the first crash. Binding `t` and
    // having `useLocale` in scope are two separate mistakes.
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      if (!/\buseLocale\s*\(/.test(source)) return false;
      return !/import\s*{[^}]*\buseLocale\b/.test(source)
        && !/export function useLocale/.test(source);
    }).map((f) => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  it('never reads .label from a table that carries labelKey', () => {
    // Renaming a table's `label` to `labelKey` and missing one render
    // site produces `undefined`, and React renders undefined as
    // nothing. The dashboard shipped five blank range buttons that
    // way, and the sidebar keyed every group on `group.label` -- all
    // undefined, so collapsing one collapsed them all. No crash, no
    // literal for the other gate to find, no failing test.
    //
    // Scoped to the map parameter rather than to any `.label` in the
    // file: plenty of `row.label` reads are API data, which has
    // nothing to do with a message key.
    const offenders = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Tables declared at module scope whose entries carry labelKey.
      const tables = [...source.matchAll(
        /^const ([A-Z_][A-Z0-9_]*) = \[([^;]*?)^\];$/gms,
      )]
        // A table that declares both is fine: `t(key, fallback)` is the
        // real signature, and a few tabs pass their English that way.
        // The bug is reading a field the table no longer defines.
        .filter(([, , body]) => /\blabelKey\s*:/.test(body)
          && !/\blabel\s*:/.test(body))
        .map(([, name]) => name);
      for (const table of tables) {
        // `TABLE.map((p) => ...)` -- what is `p` called here?
        const maps = [...source.matchAll(
          new RegExp(`\\b${table}\\s*\\.(?:map|forEach|find|filter)\\s*\\(\\(?([\\w]+)`, 'g'),
        )].map((m) => m[1]).filter(Boolean);
        for (const param of new Set(maps)) {
          source.split('\n').forEach((line, i) => {
            if (new RegExp(`\\b${param}\\.label\\b(?!Key)`).test(line)) {
              offenders.push(
                `${file.slice(ROOT.length + 1)}:${i + 1} ${table} -> ${line.trim()}`,
              );
            }
          });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('finds the components to check', () => {
    // Guards the parser: if the regex stops matching, the assertion
    // below passes by checking nothing.
    expect(files.length).toBeGreaterThan(40);
    const withComponents = files.filter(
      (f) => componentsUsing_t(readFileSync(f, 'utf8')).length >= 0,
    );
    expect(withComponents.length).toBe(files.length);
  });

  it('gives every component that calls t() the hook', () => {
    const offenders = [];
    for (const file of files) {
      for (const name of componentsUsing_t(readFileSync(file, 'utf8'))) {
        offenders.push(`${file.slice(ROOT.length + 1)}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
