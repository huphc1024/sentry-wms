import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { messages } from './messages/index.js';
import {
  LOCALE_STORAGE_KEY,
  getStoredLocale,
  interpolate,
  translate,
} from './translate.js';

const LocaleContext = createContext(null);

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(getStoredLocale);

  const setLocale = useCallback((next) => {
    const value = next === 'en' ? 'en' : 'vi';
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, value);
    } catch { /* private mode */ }
    setLocaleState(value);
  }, []);

  // Two shapes, both already in use: t(key, 'fallback', vars) and the
  // commoner t(key, { vars }).
  const t = useCallback((key, fallbackOrVars, maybeVars) => {
    const fallback = typeof fallbackOrVars === 'string' ? fallbackOrVars : undefined;
    const vars = typeof fallbackOrVars === 'string' ? maybeVars : fallbackOrVars;
    return translate(locale, key, fallback, vars);
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  );
}

/**
 * What `useLocale` returns when a component renders outside the provider.
 *
 * No provider means no localization: `t` resolves against the English
 * table. The app always mounts LocaleProvider at the root, so this
 * only shows up when a single component is rendered on its own -- which is
 * how the tests render DataTable, Modal, PageHeader and the pages built on
 * them. Before this existed those renders threw, and eleven test files went
 * red rather than assert anything.
 */
const NO_LOCALE = {
  locale: 'en',
  setLocale: () => {},
  t: (key, fallbackOrVars, maybeVars) => {
    let fallback = key;
    let vars;
    if (typeof fallbackOrVars === 'string') {
      fallback = fallbackOrVars;
      vars = maybeVars;
    } else if (fallbackOrVars && typeof fallbackOrVars === 'object') {
      vars = fallbackOrVars;
    }
    return interpolate(messages.en[key] ?? fallback, vars);
  },
};

export function useLocale() {
  return useContext(LocaleContext) || NO_LOCALE;
}
