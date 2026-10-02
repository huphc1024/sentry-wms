/**
 * Print the user-visible string literals in a page, with a suggested
 * key and whatever Vietnamese already exists for it.
 *
 * Usage:  node tools/i18n-scan.mjs src/pages/Backorders.jsx
 *         node tools/i18n-scan.mjs            (every unconverted page)
 *
 * Shares its detector with src/test/i18n-guard.test.js, so what this
 * prints is exactly what the guard enforces.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { detectLiterals, setKnownPhrases } from '../src/i18n/detectLiterals.js';

/**
 * Read the message tables as text rather than importing the index.
 *
 * The index assembles itself with Vite's `import.meta.glob`, which the
 * app and the test runner both understand and plain node does not --
 * and this script runs under plain node. Reading the files is also what
 * the table tests do, so the two agree on what a namespace file looks
 * like.
 */
const MSG_DIR = new URL('../src/i18n/messages/', import.meta.url);
const messages = { en: {}, vi: {} };
for (const file of readdirSync(MSG_DIR)) {
  if (!file.endsWith('.js') || file === 'index.js') continue;
  const source = readFileSync(new URL(file, MSG_DIR), 'utf8');
  for (const locale of ['en', 'vi']) {
    const start = source.indexOf(`export const ${locale} = {`);
    if (start === -1) continue;
    const block = source.slice(start, source.indexOf('\n};', start));
    // Both quote styles -- a value containing an apostrophe is written
    // with double quotes.
    const PAIR = /^\s*'([^']+)':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"),/gm;
    for (const [, key, single, double] of block.matchAll(PAIR)) {
      messages[locale][key] = single ?? double;
    }
  }
}

/** English phrase -> Vietnamese, the same map the dictionary builds. */
const known = new Map();
for (const [key, en] of Object.entries(messages.en)) {
  const vi = messages.vi[key];
  if (typeof en === 'string' && typeof vi === 'string' && en !== vi && !known.has(en)) {
    known.set(en, vi);
  }
}
/**
 * English phrase -> an existing key that already carries it.
 *
 * Only the shared namespaces are offered for reuse. A column label that
 * happens to read "Items" must not borrow `nav.items`: renaming the
 * sidebar entry would then silently rename a table header. A match in
 * any other namespace is printed as a hint, not proposed as the key.
 */
const SHARED = /^(common|status|table)\./;
const keyFor = new Map();
const hintFor = new Map();
for (const [key, en] of Object.entries(messages.en)) {
  const target = SHARED.test(key) ? keyFor : hintFor;
  if (!target.has(en)) target.set(en, key);
}

setKnownPhrases(new Set([...known.keys(), ...Object.values(messages.en)]));

const SURFACE = {
  'jsx-text': '', message: 'msg', template: 'msg',
  'prop:title': 'tip', 'prop:aria-label': 'tip', 'prop:alt': 'tip',
  'prop:placeholder': 'ph', 'prop:label': 'col',
  'prop:emptyMessage': 'msg', 'prop:fallbackMessage': 'msg',
};

const ns = (file) => {
  const base = file.split(/[\/]/).pop().replace('.jsx', '');
  return base[0].toLowerCase() + base.slice(1);
};

const leaf = (s) => s
  .replace(/\{\}/g, '')
  .replace(/[^\w\s]/g, ' ')
  .trim().split(/\s+/).slice(0, 3)
  .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
  .join('') || 'text';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tools/i18n-scan.mjs <file.jsx> [...]');
  process.exit(1);
}

let total = 0;
for (const file of files) {
  let hits;
  try { hits = detectLiterals(readFileSync(file, 'utf8')); } catch { continue; }
  if (!hits.length) continue;
  total += hits.length;
  console.log(`\n${file}  (${hits.length})`);
  for (const h of hits) {
    const reuse = keyFor.get(h.text);
    const hint = hintFor.get(h.text);
    const suggested = reuse || [ns(file), SURFACE[h.kind], leaf(h.text)].filter(Boolean).join('.');
    const vi = known.get(h.text);
    console.log(
      `  ${String(h.line).padStart(4)}  ${suggested}`
      + (reuse ? '   [dùng lại]' : '')
      + (!reuse && hint ? `   [cùng chữ với ${hint}]` : '')
      + `\n        en: ${h.text}`
      + (vi ? `\n        vi: ${vi}` : '\n        vi: -- cần dịch --'),
    );
  }
}
console.log(`\n${total} chuỗi trong ${files.length} file`);
