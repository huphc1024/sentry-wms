import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from './api.js';
import { friendlyErrorFromResponse } from './utils/friendlyError.js';
import { useLocale } from './i18n/locale.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { t } = useLocale();
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The session lives in an HttpOnly cookie (sentry_portal_auth); there
    // is nothing readable in JS to inspect, so ask the API who we are.
    // 401 simply means "not signed in" and must not redirect -- that is
    // the normal first-load state on the login screen.
    let cancelled = false;
    api.get('/auth/me', { redirectOn401: false }).then(async (res) => {
      if (cancelled) return;
      if (res && res.ok) setAccount(await res.json());
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // /auth/me is the source of truth for both `features` and
  // `must_change_password`, and @require_customer_auth re-reads them from
  // the DB on every request. Re-fetching after a password change is what
  // lets the router guard release the forced-change screen.
  const refresh = useCallback(async () => {
    const res = await api.get('/auth/me', { redirectOn401: false });
    if (res && res.ok) {
      const data = await res.json();
      setAccount(data);
      return data;
    }
    return null;
  }, []);

  async function login(username, password) {
    const res = await api.post('/auth/login', { username, password });
    if (!res || !res.ok) {
      throw new Error(await friendlyErrorFromResponse(
        res, t('auth.loginFailed'),
      ));
    }
    // The login response carries the customer_user row but no feature
    // grants, so read the full identity from /auth/me rather than
    // rendering a nav that has to be corrected a moment later.
    return refresh();
  }

  async function logout() {
    try {
      await api.post('/auth/logout', {});
    } finally {
      setAccount(null);
    }
  }

  return (
    <AuthContext.Provider value={{ account, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Does the signed-in account hold this portal feature grant? */
export function hasFeature(account, feature) {
  return Boolean(account?.features?.includes(feature));
}
