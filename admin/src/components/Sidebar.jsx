import { NavLink, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useWarehouse } from '../warehouse.jsx';
import { useLocale } from '../i18n/locale.jsx';

// Each NAV item carries a labelKey into messages/chrome.js and a
// page_key matching api/constants.py
// ALL_PAGE_KEYS. Sidebar filters by the user's allowed_pages so a
// USER without the grant never sees the link (and the backend
// rejects direct URL hits via @require_admin_or_page_permission).
// Dashboard intentionally has no page_key: it is reachable by any
// authenticated user so the badges below populate.
const NAV = [
  {
    labelKey: 'nav.floor',
    items: [
      { to: '/', labelKey: 'nav.dashboard', pageKey: 'dashboard' },
      { to: '/inventory', labelKey: 'nav.inventory', pageKey: 'inventory' },
      { to: '/cycle-counts', labelKey: 'nav.counts', pageKey: 'cycle-counts' },
      { to: '/count-approvals', labelKey: 'nav.approvals', pageKey: 'count-approvals' },
    ],
  },
  {
    labelKey: 'nav.inbound',
    items: [
      { to: '/purchase-orders', labelKey: 'nav.purchaseOrders', pageKey: 'purchase-orders' },
      { to: '/receiving', labelKey: 'nav.receiving', pageKey: 'receiving' },
      { to: '/putaway', labelKey: 'nav.putaway', pageKey: 'putaway' },
    ],
  },
  {
    labelKey: 'nav.outbound',
    items: [
      { to: '/sales-orders', labelKey: 'nav.salesOrders', pageKey: 'sales-orders' },
      { to: '/pos-activity', labelKey: 'nav.posActivity', pageKey: 'pos-activity' },
      { to: '/fraud', labelKey: 'nav.fraud', pageKey: 'fraud' },
      { to: '/backorders', labelKey: 'nav.backorders', pageKey: 'backorders' },
      { to: '/picking-tickets', labelKey: 'nav.pickingTickets', pageKey: 'picking-tickets' },
      { to: '/returns', labelKey: 'nav.returns', pageKey: 'sales-orders' },
      { to: '/picking-batches', labelKey: 'nav.pickingBatches', pageKey: 'picking-batches' },
    ],
  },
  {
    labelKey: 'nav.warehouse',
    items: [
      { to: '/warehouse-simulation', labelKey: 'nav.simulation', pageKey: 'warehouse-simulation' },
      { to: '/items', labelKey: 'nav.items', pageKey: 'items' },
      { to: '/vendors', labelKey: 'nav.vendors', pageKey: 'vendors' },
      { to: '/adjustments', labelKey: 'nav.adjustments', pageKey: 'adjustments' },
      { to: '/inter-warehouse-transfers', labelKey: 'nav.transfers', pageKey: 'inter-warehouse-transfers' },
      { to: '/transfer-orders', labelKey: 'nav.transferOrders', pageKey: 'transfer-orders' },
        { to: '/data', labelKey: 'nav.data', pageKeys: ['warehouses', 'bins', 'zones', 'preferred-bins'] },
        { to: '/pallets', labelKey: 'nav.pallets', pageKey: 'pallets' },
        { to: '/expiry', labelKey: 'nav.expiry', pageKey: 'expiry' },
        { to: '/vehicle-movements', labelKey: 'nav.vehicleMovements', pageKey: 'vehicle-movements' },
    ],
  },
    {
      labelKey: 'nav.billing',
      items: [
        { to: '/customers', labelKey: 'nav.customers', pageKey: 'billing' },
        { to: '/rate-cards', labelKey: 'nav.rateCards', pageKey: 'billing' },
        { to: '/invoices', labelKey: 'nav.invoices', pageKey: 'billing' },
      ],
    },
  {
    labelKey: 'nav.system',
    items: [
      { to: '/users', labelKey: 'nav.users', pageKey: 'users' },
      { to: '/api-tokens', labelKey: 'nav.apiTokens', pageKey: 'api-tokens' },
      { to: '/inbound', labelKey: 'nav.inboundActivity', pageKey: 'inbound' },
      { to: '/consumer-groups', labelKey: 'nav.consumerGroups', pageKey: 'consumer-groups' },
      { to: '/webhooks', labelKey: 'nav.webhooks', pageKey: 'webhooks' },
      { to: '/channels', labelKey: 'nav.channels', pageKey: 'channels' },
      { to: '/notifications', labelKey: 'nav.notifications', pageKey: 'notifications' },
      { to: '/audit-log', labelKey: 'nav.auditLog', pageKey: 'audit-log' },
      { to: '/imports', labelKey: 'nav.import', pageKey: 'imports' },
      { to: '/integrations', labelKey: 'nav.integrations', pageKey: 'integrations' },
      { to: '/settings', labelKey: 'nav.settings', pageKey: 'settings' },
    ],
  },
];

function canSeeNavItem(user, item) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  const allowed = user.allowed_pages;
  if (!Array.isArray(allowed)) return false;
  if (item.pageKeys) {
    return item.pageKeys.some((k) => allowed.includes(k));
  }
  if (item.pageKey) {
    return allowed.includes(item.pageKey);
  }
  return true;
}

export default function Sidebar() {
  const location = useLocation();
  const { user } = useAuth();
  const { warehouseId } = useWarehouse();
  const { t } = useLocale();
  const [counts, setCounts] = useState({});
  // The POS Activity tab is opt-in via the pos_activity_enabled setting
  // so non-POS deployments never see it. Default false: the entry is
  // hidden until an operator turns it on in Settings > POS. Silent on
  // permission denial so a USER without the settings grant just gets
  // the default (hidden) rather than a Permissions Error popup.
  const [posActivityEnabled, setPosActivityEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get(
      '/admin/settings/pos_activity_enabled',
      { silentPermissionDenied: true },
    ).then(async (res) => {
      if (!res?.ok || cancelled) return;
      const data = await res.json();
      setPosActivityEnabled(data?.value === 'true');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!warehouseId) return;
    // Same silent treatment for the dashboard counts (sidebar badges).
    // /admin/dashboard is intentionally any-auth so this typically
    // succeeds, but a future tightening should not blow up the UI
    // with a modal on every page load.
    api.get(
      `/admin/dashboard?warehouse_id=${warehouseId}`,
      { silentPermissionDenied: true },
    ).then(async (res) => {
      if (!res || !res.ok) return;
      const data = await res.json();
      setCounts({
        '/receiving': data.open_pos || 0,
        '/putaway': data.pending_putaway || 0,
        '/count-approvals': data.pending_adjustments || 0,
        // /picking, /packing, /shipping badges were removed alongside
        // their retired nav entries; the throughput counts still live
        // on the Dashboard page itself.
        // v1.8.0 (#296): pending TO approvals scoped to the active
        // warehouse (source OR destination match). Falls back to 0
        // when the dashboard endpoint is the older shape.
        '/transfer-orders': data.pending_to_approvals || 0,
      });
    });
  }, [location.pathname, warehouseId]);

  const navGroups = (posActivityEnabled
    ? NAV
    : NAV.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.to !== '/pos-activity'),
      }))
  ).map((group) => ({
    ...group,
    items: group.items.filter((item) => canSeeNavItem(user, item)),
  })).filter((group) => group.items.length > 0);

  // Per-section collapse, persisted so a hidden section stays hidden across
  // reloads. The header carries a caret; clicking it toggles its items.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('sidebar.collapsed') || '{}');
    } catch {
      return {};
    }
  });
  function toggleGroup(label) {
    setCollapsed((c) => {
      const next = { ...c, [label]: !c[label] };
      try {
        localStorage.setItem('sidebar.collapsed', JSON.stringify(next));
      } catch {
        /* ignore quota / private-mode write failures */
      }
      return next;
    });
  }

  return (
    <nav className="sidebar">
      {navGroups.map((group) => {
        const isCollapsed = !!collapsed[group.labelKey];
        return (
          <div key={group.labelKey} className="sidebar-card">
            <div
              className="sidebar-group-label"
              role="button"
              tabIndex={0}
              aria-expanded={!isCollapsed}
              onClick={() => toggleGroup(group.labelKey)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleGroup(group.labelKey);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <span>{t(group.labelKey)}</span>
              <span style={{ fontSize: 10, opacity: 0.7 }} aria-hidden>
                {isCollapsed ? '▸' : '▾'}
              </span>
            </div>
            {!isCollapsed && group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `sidebar-link${isActive ? ' active' : ''}` // i18n-ignore
                }
              >
                <span>{t(item.labelKey)}</span>
                {counts[item.to] > 0 && (
                  <span className="sidebar-badge">{counts[item.to]}</span>
                )}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
