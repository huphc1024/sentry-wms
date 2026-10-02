/**
 * Translation without React.
 *
 * The provider (locale.js) owns the locale a screen re-renders on. Plain
 * functions -- the API client, scan helpers -- cannot use a hook, so the
 * resolution lives here as a pure function and the current locale is
 * mirrored in a module variable the provider keeps up to date.
 *
 * The stored locale is read in exactly one place (loadStoredLocale), and
 * a test asserts nothing else names the storage key.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { messages } from './messages/index.js';

export const LOCALE_STORAGE_KEY = 'sentry_mobile_locale';

/** Vietnamese is the default; the handheld is used on a Vietnamese floor. */
export const DEFAULT_LOCALE = 'vi';

let current = DEFAULT_LOCALE;

export function getCurrentLocale() {
  return current;
}

export function setCurrentLocale(locale) {
  current = locale === 'en' ? 'en' : 'vi';
  return current;
}

export async function loadStoredLocale() {
  try {
    const saved = await AsyncStorage.getItem(LOCALE_STORAGE_KEY);
    return saved === 'en' ? 'en' : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export async function storeLocale(locale) {
  try {
    await AsyncStorage.setItem(LOCALE_STORAGE_KEY, locale === 'en' ? 'en' : 'vi');
  } catch {
    // Storage blocked: the choice lasts until the app closes.
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
 * Resolve one key. Deliberately does not fall back to the other
 * language: a key with an English value and no Vietnamese one must show
 * up as the key (noticeable), not as English (indistinguishable from a
 * chosen translation). The table test requires every key in both.
 */
export function translate(locale, key, fallback, vars) {
  const table = messages[locale] || messages[DEFAULT_LOCALE];
  return interpolate(table[key] ?? fallback ?? key, vars);
}

/** Resolve against the current locale. For non-React callers. */
export function t(key, fallbackOrVars, maybeVars) {
  const fallback = typeof fallbackOrVars === 'string' ? fallbackOrVars : undefined;
  const vars = typeof fallbackOrVars === 'string' ? maybeVars : fallbackOrVars;
  return translate(current, key, fallback, vars);
}
