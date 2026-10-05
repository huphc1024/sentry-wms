/**
 * Lists the user-visible literals still written into portal source.
 *
 *   node tools/i18n-scan.mjs                    every .jsx under src/
 *   node tools/i18n-scan.mjs src/pages/Login.jsx
 *
 * Same detector as src/test/i18n-guard.test.js.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { detectLiterals } from '../src/i18n/detectLiterals.js';

const SKIP = new Set(['test', 'i18n']);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP.has(name)) walk(path, out);
    } else if (name.endsWith('.jsx')) {
      out.push(path);
    }
  }
  return out;
}

const args = process.argv.slice(2);
const files = args.length ? args : walk('src');
let total = 0;
for (const file of files) {
  const hits = detectLiterals(readFileSync(file, 'utf8'));
  if (!hits.length) continue;
  total += hits.length;
  console.log(`\n${file}  (${hits.length})`);
  for (const h of hits) console.log(`  ${String(h.line).padStart(4)}  [${h.kind}] ${h.text}`);
}
console.log(`\ntotal ${total}`);
