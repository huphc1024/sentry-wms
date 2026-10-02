import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth, hasFeature } from '../auth.jsx';
import StatusTag from '../components/StatusTag.jsx';
import { useLocale } from '../i18n/locale.jsx';
import { formatDate, formatMoney, formatNumber } from '../utils/format.js';

const OPEN_SO_STATUSES = new Set(['OPEN', 'WAITING_STOCK', 'PICKED', 'PACKED']);

/**
 * Landing page. Every tile is driven by the same list endpoints the
 * detail pages use, asked for a short page: the envelope's `total` gives
 * the count and the rows give the "recent" strip, so no dashboard-only
 * endpoint had to be added to the portal API.
 *
 * A tile whose feature is not granted is not rendered at all. A 403 that
 * slips through anyway (grant revoked between /auth/me and this fetch)
 * leaves the tile empty rather than raising -- the nav is a convenience,
 * the server is the gate.
 */
export default function Dashboard() {
  const { account } = useAuth();
  const { t } = useLocale();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      async function fetchList(path, key, params) {
        const res = await api.get(`${path}${qs(params)}`);
        if (!res || !res.ok) return { total: 0, rows: [], denied: Boolean(res) };
        const data = await res.json();
        return { total: data.total || 0, rows: data[key] || [], denied: false };
      }

      const [inventory, orders, inbound, invoices] = await Promise.all([
        hasFeature(account, 'inventory')
          ? fetchList('/inventory', 'items', { page_size: 5 })
          : null,
        hasFeature(account, 'orders')
          ? fetchList('/orders', 'orders', { page_size: 5 })
          : null,
        hasFeature(account, 'inbound')
          ? fetchList('/inbound', 'purchase_orders', { page_size: 5 })
          : null,
        hasFeature(account, 'invoices')
          ? fetchList('/invoices', 'invoices', { page_size: 3 })
          : null,
      ]);
      if (cancelled) return;
      setState({ loading: false, inventory, orders, inbound, invoices });
    })();
    return () => { cancelled = true; };
  }, [account]);

  const { loading, inventory, orders, inbound, invoices } = state;
  const noFeatures = (account?.features?.length || 0) === 0;

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('dashboard.title')}</h1>
      </div>

      {noFeatures && (
        <div className="alert alert-warning" role="status">
          {t('dashboard.noFeatures')}
        </div>
      )}

      <div className="stat-grid">
        {inventory && (
          <Link className="stat" to="/inventory">
            <span>{t('dashboard.inventoryLines')}</span>
            <strong>{loading ? '…' : formatNumber(inventory.total)}</strong>
            <em>{t('dashboard.inventoryLinesHint')}</em>
          </Link>
        )}
        {orders && (
          <Link className="stat" to="/orders">
            <span>{t('dashboard.openOrders')}</span>
            <strong>
              {loading ? '…' : formatNumber(orders.rows.filter((o) => OPEN_SO_STATUSES.has(o.status)).length)}
            </strong>
            <em>{t('dashboard.openOrdersHint', { total: formatNumber(orders.total) })}</em>
          </Link>
        )}
        {inbound && (
          <Link className="stat" to="/inbound">
            <span>{t('dashboard.inboundReceipts')}</span>
            <strong>{loading ? '…' : formatNumber(inbound.total)}</strong>
            <em>{t('dashboard.inboundReceiptsHint')}</em>
          </Link>
        )}
        {invoices && (
          <Link className="stat" to="/invoices">
            <span>{t('dashboard.invoicesIssued')}</span>
            <strong>{loading ? '…' : formatNumber(invoices.total)}</strong>
            <em>{t('dashboard.invoicesIssuedHint')}</em>
          </Link>
        )}
      </div>

      <div className="dash-columns">
        {orders && (
          <section className="card">
            <h2 className="card-title">{t('dashboard.recentOrders')}</h2>
            {loading && <div className="card-note">{t('dashboard.loading')}</div>}
            {!loading && orders.rows.length === 0 && (
              <div className="card-note">{t('dashboard.noOrders')}</div>
            )}
            <ul className="mini-list">
              {orders.rows.map((o) => (
                <li key={o.so_number}>
                  <Link className="mono" to={`/orders/${encodeURIComponent(o.so_number)}`}>
                    {o.so_number}
                  </Link>
                  <StatusTag status={o.status} />
                  <span className="text-muted">{formatDate(o.order_date)}</span>
                </li>
              ))}
            </ul>
            <Link className="btn btn-sm" to="/orders/new">{t('dashboard.newOrder')}</Link>
          </section>
        )}

        {inbound && (
          <section className="card">
            <h2 className="card-title">{t('dashboard.recentInbound')}</h2>
            {loading && <div className="card-note">{t('dashboard.loading')}</div>}
            {!loading && inbound.rows.length === 0 && (
              <div className="card-note">{t('dashboard.noInbound')}</div>
            )}
            <ul className="mini-list">
              {inbound.rows.map((p) => (
                <li key={p.po_number}>
                  <span className="mono">{p.po_number}</span>
                  <StatusTag status={p.status} />
                  <span className="text-muted">
                    {formatNumber(p.quantity_received)}/{formatNumber(p.quantity_ordered)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {invoices && (
          <section className="card">
            <h2 className="card-title">{t('dashboard.recentInvoices')}</h2>
            {loading && <div className="card-note">{t('dashboard.loading')}</div>}
            {!loading && invoices.rows.length === 0 && (
              <div className="card-note">{t('dashboard.noInvoices')}</div>
            )}
            <ul className="mini-list">
              {invoices.rows.map((inv) => (
                <li key={inv.invoice_number}>
                  <Link className="mono" to={`/invoices/${encodeURIComponent(inv.invoice_number)}`}>
                    {inv.invoice_number}
                  </Link>
                  <StatusTag status={inv.status} />
                  <span className="mono">{formatMoney(inv.total_amount, inv.currency)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
