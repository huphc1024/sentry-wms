/**
 * Portal API client.
 *
 * Two differences from admin/src/api.js, both deliberate:
 *
 *  1. Every path is prefixed with /api/portal, so a page in this bundle
 *     cannot accidentally address a staff endpoint. A typo produces a
 *     404 on the portal blueprint rather than a request the staff
 *     middleware then has to reject.
 *  2. The CSRF cookie read is `sentry_portal_csrf`, not `sentry_csrf`
 *     (services/cookie_auth.py). Reading the staff cookie here would
 *     send an operator's CSRF token to a portal route -- which fails the
 *     double-submit compare anyway, but only after the browser has
 *     already put it on the wire.
 */

const API_BASE = '/api/portal';

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)sentry_portal_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function apiFetch(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const needsCsrf = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const csrfToken = needsCsrf ? getCsrfToken() : null;
  const { redirectOn401 = true, ...fetchOptions } = options;
  const headers = {
    'Content-Type': 'application/json',
    ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
    ...fetchOptions.headers,
  };
  const res = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
    credentials: 'include',
  });
  // The auth probes own their 401 (AuthProvider renders the login screen
  // from it); anything else means the session died mid-session, so bounce
  // to /login rather than leaving a page showing stale data.
  if (res.status === 401 && redirectOn401
      && !path.startsWith('/auth/login') && !path.startsWith('/auth/me')) {
    window.location.href = '/login';
    return;
  }
  return res;
}

export const api = {
  get: (path, opts) => apiFetch(path, { ...(opts || {}) }),
  post: (path, body, opts) => apiFetch(path, { method: 'POST', body: JSON.stringify(body), ...(opts || {}) }),
};

/** Build a query string, dropping empty values. */
export function qs(params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    search.set(k, String(v));
  });
  const s = search.toString();
  return s ? `?${s}` : '';
}
