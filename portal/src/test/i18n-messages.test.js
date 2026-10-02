// @vitest-environment node
// This file never touches the DOM. Building a jsdom for it cost about
// eighteen seconds of the suite's wall clock and, on a loaded machine,
// starved the tests that do need one into a timeout.

/**
 * Invariants on the message tables themselves.
 *
 * These exist because of a bug they would have caught: seven `nav.*`
 * keys had an English value and no Vietnamese one, so the sidebar
 * rendered "Pallets", "Expiry", "Billing" and four others in English on
 * a Vietnamese screen. Nothing failed. `t()` falls back through
 * `messages.vi[key] ?? messages.en[key]` before it reaches the caller's
 * fallback, so a missing translation is indistinguishable from a
 * deliberate one, and the sidebar sits outside the DOM sweep that
 * rescues the rest of the app.
 *
 * Read as text rather than imported: the tables are plain object
 * literals, there is nothing to execute, and this keeps the suite out of
 * jsdom for a check that is pure string work.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const DIR = `${globalThis.process.cwd()}/src/i18n/messages`;

const FILES = readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'index.js');

/**
 * Pull one locale's half of one namespace file. Read as text rather than
 * imported: these are plain object literals, there is nothing to
 * execute, and it keeps the check out of jsdom.
 */
function tableIn(source, locale) {
  const start = source.indexOf(`export const ${locale} = {`);
  if (start === -1) return {};
  const block = source.slice(start, source.indexOf('\n};', start));
  const out = {};
  // Both quote styles: a value containing an apostrophe is written with
  // double quotes, and a parser that only knew single ones reported the
  // key as missing from that language -- a parity failure with nothing
  // actually wrong.
  const PAIR = /^\s*'([^']+)':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"),/gm;
  for (const [, key, single, double] of block.matchAll(PAIR)) {
    out[key] = single ?? double;
  }
  return out;
}

/** Merge every namespace file, and record which file each key came from. */
function merged(locale) {
  const out = {};
  const from = {};
  for (const file of FILES) {
    const source = readFileSync(`${DIR}/${file}`, 'utf8');
    for (const [key, value] of Object.entries(tableIn(source, locale))) {
      if (key in out) throw new Error(`${key} declared in both ${from[key]} and ${file}`);
      out[key] = value;
      from[key] = file;
    }
  }
  return out;
}

const en = merged('en');
const vi = merged('vi');

describe('message tables', () => {
  it('reads every namespace file', () => {
    // Guards the parser above: if the regex stops matching, or a new
    // namespace file is added in a shape it does not recognise, every
    // assertion below would pass by comparing two empty objects.
    expect(FILES.length).toBeGreaterThan(3);
    expect(Object.keys(en).length).toBeGreaterThan(100);
    expect(Object.keys(vi).length).toBeGreaterThan(100);
  });

  it('keeps each key in exactly one namespace file', () => {
    // `merged()` throws on a duplicate; this states the rule out loud so
    // the failure reads as a rule rather than as a crash.
    expect(() => merged('en')).not.toThrow();
    expect(() => merged('vi')).not.toThrow();
  });

  it('defines every key in both languages', () => {
    const enOnly = Object.keys(en).filter((k) => !(k in vi));
    const viOnly = Object.keys(vi).filter((k) => !(k in en));
    expect({ enOnly, viOnly }).toEqual({ enOnly: [], viOnly: [] });
  });

  it('leaves no value empty', () => {
    const blank = [
      ...Object.entries(en).filter(([, v]) => !v.trim()).map(([k]) => `en ${k}`),
      ...Object.entries(vi).filter(([, v]) => !v.trim()).map(([k]) => `vi ${k}`),
    ];
    expect(blank).toEqual([]);
  });

  it('keeps the same interpolation placeholders in both languages', () => {
    // A translator dropping `{so}` from a modal title renders a sentence
    // with a hole in it, and no type or lint catches that.
    const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const mismatched = Object.keys(en)
      .filter((k) => k in vi)
      .filter((k) => names(en[k]).join() !== names(vi[k]).join())
      .map((k) => `${k}: en{${names(en[k])}} vi{${names(vi[k])}}`);
    expect(mismatched).toEqual([]);
  });

  it('translates the Vietnamese value away from the English one', () => {
    // A vi value identical to its en value is almost always a key that
    // was copied and never translated. The exceptions are the handful of
    // strings that genuinely do not change.
    const SAME_ON_PURPOSE = new Set([
      'lang.en', 'lang.vi', 'settings.section.pos',
      // Vietnamese warehouses say "pallet"; there is no other word
      // for it on the floor.
      'warehouseSimulation.pallet',
      // Borrowed into Vietnamese unchanged, like "pallet".
      'customers.email',
      // A marketplace's own name; placeholders that show one.
      'channels.nameExample',
      'consumerGroups.connectorIdExample',
      'consumerGroups.displayNameExample',
      'notifications.channelTeams',
    ]);
    // A value made only of dotted slugs is a code sample shown as a
    // placeholder -- `events.poll, snapshot.inventory`. It is the same
    // in every language because it is not language. Matching on shape
    // beats growing the list above by one entry per example.
    const SLUG_LIST = /^[a-z0-9_.]+(?:,\s*[a-z0-9_.]+)*$/;
    const untranslated = Object.keys(en)
      .filter((k) => k in vi && !SAME_ON_PURPOSE.has(k))
      .filter((k) => !SLUG_LIST.test(en[k]))
      // A value with no letters outside its placeholders carries no
      // language at all -- `{from} → {to}` is punctuation and holes.
      .filter((k) => /[a-z]/i.test(en[k].replace(/\{\w+\}/g, '')))
      .filter((k) => en[k] === vi[k] && /[a-z]{3}/.test(en[k]))
      .map((k) => `${k}: ${en[k]}`);
    expect(untranslated).toEqual([]);
  });
});
