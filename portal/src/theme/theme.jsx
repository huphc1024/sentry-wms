import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Light / dark mode for the customer portal.
 *
 * The mode lives in one place -- a `data-theme` attribute on <html> --
 * and everything else follows from it: App.css redefines its tokens
 * under `:root[data-theme="dark"]`, and antd is handed a matching config
 * from antdTheme.js. Nothing reads the mode to branch on colours; if a
 * component needs a different colour in dark mode, that belongs in a
 * token, not in a condition.
 *
 * Deliberately a copy of the admin panel's, not an import: the two are
 * separate deployables and the portal should not gain a build dependency
 * on the staff app. The storage key differs so a customer's choice and a
 * warehouse operator's do not overwrite each other on a shared browser.
 */

const STORAGE_KEY = 'sentry_portal_theme';

const ThemeContext = createContext(null);

/** The mode to start in: what was chosen before, else what the OS asks for. */
export function initialMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* private mode, blocked storage */ }
  try {
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch { /* jsdom, old browsers */ }
  return 'light';
}

/** Put the mode where CSS can see it. Exported for the pre-paint script. */
export function applyMode(mode) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', mode);
  }
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(initialMode);

  useEffect(() => { applyMode(mode); }, [mode]);

  const setMode = useCallback((next) => {
    const value = next === 'dark' ? 'dark' : 'light';
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* ignore */ }
    setModeState(value);
  }, []);

  const toggleMode = useCallback(() => {
    setModeState((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ mode, setMode, toggleMode, isDark: mode === 'dark' }),
    [mode, setMode, toggleMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Falls back to light rather than throwing, so a component can be
 * rendered on its own -- in a test, or in isolation -- without the whole
 * provider tree. Same reasoning as useLocale.
 */
const NO_THEME = { mode: 'light', setMode: () => {}, toggleMode: () => {}, isDark: false };

export function useTheme() {
  return useContext(ThemeContext) || NO_THEME;
}
