import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useLocale } from '../i18n/locale.jsx';

const TABS = [
  { to: 'warehouses', labelKey: 'nav.warehouses', pageKey: 'warehouses' },
  { to: 'bins', labelKey: 'nav.bins', pageKey: 'bins' },
  { to: 'zones', labelKey: 'nav.zones', pageKey: 'zones' },
  { to: 'preferred-bins', labelKey: 'nav.preferredBins', pageKey: 'preferred-bins' },
];

export default function Data() {
  const { user } = useAuth();
  const { t } = useLocale();
  const location = useLocation();
  const allowedPages = user?.allowed_pages;
  const isAdmin = user?.role === 'ADMIN';

  const visibleTabs = TABS.filter((tab) =>
    isAdmin || (Array.isArray(allowedPages) && allowedPages.includes(tab.pageKey)),
  );

  if (location.pathname === '/data' || location.pathname === '/data/') {
    if (visibleTabs.length === 0) {
      return (
        <div style={{ padding: 24, color: 'var(--text-secondary)' }}>
          {t('data.noAccess')}
        </div>
      );
    }
    return <Navigate to={visibleTabs[0].to} replace />;
  }

  return (
    <div>
      <div className="data-tabs">
        {visibleTabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `data-tab${isActive ? ' active' : ''}`
            }
          >
            {t(tab.labelKey)}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
