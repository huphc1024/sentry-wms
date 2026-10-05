/**
 * Translation without React.
 *
 * Most of the app reaches translation through `useLocale()`, which is
 * the right way round: the provider owns the current locale and
 * re-renders when it changes. Two places cannot. `ErrorBoundary` is a
 * class component that has to render when the tree below it has already
 * thrown, and `friendlyError` is a plain function called from API
 * handlers. Both had grown their own copy of the machinery -- their own
 * Vietnamese map, their own `localStorage.getItem('sentry_admin_locale')`
 * -- which is how the app ended up with five translation mechanisms
 * instead of one.
 *
 * So the resolution lives here as a pure function, the stored locale is
 * read in exactly one place, and both the provider and the two
 * non-React callers use them. A test asserts that nothing else reads
 * that storage key.
 */

import { messages } from './messages/index.js';

export const LOCALE_STORAGE_KEY = 'sentry_admin_locale';

/** Vietnamese is the default; the app is used in a Vietnamese warehouse. */
export function getStoredLocale() {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    return saved === 'en' ? 'en' : 'vi';
  } catch {
    // Private mode, or storage blocked by policy.
    return 'vi';
  }
}

/** Substitute `{name}` placeholders, leaving unknown ones visible. */
export function interpolate(template, vars) {
  if (!vars || typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => (
    vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : `{${key}}`
  ));
}

/**
 * Resolve one key.
 *
 * Deliberately does NOT fall back to the other language. It used to:
 * `table[key] ?? messages.vi[key] ?? messages.en[key] ?? fallback`. That
 * chain is why seven sidebar entries rendered in English on a Vietnamese
 * screen for as long as they did -- a key with an English value and no
 * Vietnamese one resolved to the English, indistinguishable from a
 * translation somebody had chosen. A missing key now surfaces as the
 * caller's fallback, or as the key itself, which is noticeable.
 *
 * The table invariants make the stricter behaviour safe: every key is
 * required to exist in both languages.
 */
export function translate(locale, key, fallback, vars) {
  const table = messages[locale] || messages.vi;
  return interpolate(table[key] ?? fallback ?? key, vars);
}

/** Resolve against whatever locale is stored. For the non-React callers. */
export function t(key, fallback, vars) {
  return translate(getStoredLocale(), key, fallback, vars);
}
