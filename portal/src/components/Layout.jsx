import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, hasFeature } from '../auth.jsx';
import { BRAND_NAME, PORTAL_NAME } from '../brand.js';
import { useTheme } from '../theme/theme.jsx';
import { useLocale } from '../i18n/locale.jsx';

/**
 * Nav is filtered by the feature grants on /auth/me. That is a
 * convenience, not the control: @require_customer_feature returns 403 on
 * a direct URL hit regardless of what this renders -- same client-hides /
 * server-enforces split as the admin sidebar (docs/patterns.md §6).
 */
const NAV = [
  { to: '/', labelKey: 'chrome.nav.dashboard', feature: null, end: true },
  { to: '/inventory', labelKey: 'chrome.nav.inventory', feature: 'inventory' }, // i18n-ignore (feature code)
  { to: '/orders', labelKey: 'chrome.nav.orders', feature: 'orders' }, // i18n-ignore (feature code)
  { to: '/inbound', labelKey: 'chrome.nav.inbound', feature: 'inbound' }, // i18n-ignore (feature code)
  { to: '/invoices', labelKey: 'chrome.nav.invoices', feature: 'invoices' }, // i18n-ignore (feature code)
];

export function PortalLogo() {
  return (
    <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="5" fill="#8e2715" />
      <rect x="7" y="6" width="7.5" height="20" rx="1.5" fill="none" stroke="#FCF4E3" strokeWidth="1.6" />
      <rect x="17.5" y="6" width="7.5" height="20" rx="1.5" fill="none" stroke="#FCF4E3" strokeWidth="1.6" />
      <line x1="8.5" y1="12" x2="13" y2="12" stroke="#FCF4E3" strokeWidth="1" opacity="0.4" />
      <line x1="8.5" y1="16" x2="13" y2="16" stroke="#FCF4E3" strokeWidth="1" opacity="0.4" />
      <line x1="8.5" y1="20" x2="13" y2="20" stroke="#FCF4E3" strokeWidth="1" opacity="0.4" />
      <line x1="19" y1="12" x2="23.5" y2="12" stroke="#FCF4E3" strokeWidth="1" opacity="0.4" />
      <line x1="19" y1="16" x2="23.5" y2="16" stroke="#FCF4E3" strokeWidth="1" opacity="0.4" />
      <line x1="19" y1="20" x2="23.5" y2="20" stroke="#FCF4E3" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

/** VI / EN switch; shared by the header and the login card. */
export function LanguageSwitch() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div className="lang-switch" role="group" aria-label={t('common.lang.label')}>
      {['vi', 'en'].map((code) => (
        <button
          key={code}
          type="button"
          className={`lang-switch-btn${locale === code ? ' active' : ''}`}
          aria-pressed={locale === code}
          onClick={() => setLocale(code)}
        >
          {t(`common.lang.${code}`)}
        </button>
      ))}
    </div>
  );
}

export default function Layout() {
  const { account, logout } = useAuth();
  const { isDark, toggleMode } = useTheme();
  const { t } = useLocale();
  const navigate = useNavigate();
  const items = NAV.filter((n) => !n.feature || hasFeature(account, n.feature));

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <PortalLogo />
          <div>
            <strong>{BRAND_NAME}</strong>
            <span>{PORTAL_NAME}</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              {t(n.labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/change-password" className="nav-link nav-link-quiet">
            {t('chrome.nav.changePassword')}
          </NavLink>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-customer">
            <strong>{account?.customer_name || '—'}</strong>
            {account?.customer_code && <span className="mono">{account.customer_code}</span>}
          </div>
          <div className="topbar-user">
            <span>{account?.full_name || account?.username}</span>
            <LanguageSwitch />
            <button
              type="button"
              className="btn btn-sm theme-toggle"
              onClick={toggleMode}
              aria-pressed={isDark}
              title={isDark ? t('chrome.theme.toLight') : t('chrome.theme.toDark')}
              aria-label={isDark ? t('chrome.theme.toLight') : t('chrome.theme.toDark')}
            >
              {isDark ? '☀' : '☽'}
            </button>
            <button type="button" className="btn btn-sm" onClick={handleLogout}>
              {t('chrome.logout')}
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
