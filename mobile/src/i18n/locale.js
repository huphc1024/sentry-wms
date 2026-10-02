import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_LOCALE,
  loadStoredLocale,
  setCurrentLocale,
  storeLocale,
  translate,
} from './translate.js';

const LocaleContext = createContext(null);

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(DEFAULT_LOCALE);

  useEffect(() => {
    let alive = true;
    loadStoredLocale().then((saved) => {
      if (!alive) return;
      setCurrentLocale(saved);
      setLocaleState(saved);
    });
    return () => { alive = false; };
  }, []);

  const setLocale = useCallback((next) => {
    const value = setCurrentLocale(next);
    storeLocale(value);
    setLocaleState(value);
  }, []);

  // t(key, { vars }) and t(key, 'fallback', vars)
  const t = useCallback((key, fallbackOrVars, maybeVars) => {
    const fallback = typeof fallbackOrVars === 'string' ? fallbackOrVars : undefined;
    const vars = typeof fallbackOrVars === 'string' ? maybeVars : fallbackOrVars;
    return translate(locale, key, fallback, vars);
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Outside a provider (a lone component in a test) the default locale applies. */
const NO_PROVIDER = {
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key, fallbackOrVars, maybeVars) => {
    const fallback = typeof fallbackOrVars === 'string' ? fallbackOrVars : undefined;
    const vars = typeof fallbackOrVars === 'string' ? maybeVars : fallbackOrVars;
    return translate(DEFAULT_LOCALE, key, fallback, vars);
  },
};

export function useLocale() {
  return useContext(LocaleContext) || NO_PROVIDER;
}
