/**
 * Lists the user-visible literals still written into mobile source.
 *
 *   node tools/i18n-scan.mjs            every file under src/
 *   node tools/i18n-scan.mjs src/screens/GateScreen.js
 *
 * Uses the same detector as the guard test (src/test/... i18n-guard), so
 * what this prints is exactly what the guard enforces.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { detectLiterals, setKnownPhrases } from '../src/i18n/detectLiterals.js';
import { messages } from '../src/i18n/messages/index.js';

setKnownPhrases(new Set(Object.values(messages.en)));

const SKIP = new Set(['__tests__', 'i18n', 'native']);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP.has(name)) walk(path, out);
    } else if (name.endsWith('.js')) {
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
