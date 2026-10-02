import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import StatusTag from '../components/StatusTag.jsx';
import { useLocale } from '../i18n/locale.jsx';
import { friendlyErrorFromResponse } from '../utils/friendlyError.js';
import { formatDate, formatNumber } from '../utils/format.js';

export default function OrderDetail() {
  const { t } = useLocale();
  const { soNumber } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await api.get(`/orders/${encodeURIComponent(soNumber)}`);
      if (cancelled || !res) return;
      if (!res.ok) {
        // 404 here covers both "no such order" and "another customer's
        // order" -- the API keeps the two indistinguishable on purpose,
        // so the UI must not speculate about which one happened.
        setError(await friendlyErrorFromResponse(res, t('orders.detail.notFound')));
        setLoading(false);
        return;
      }
      setOrder(await res.json());
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [soNumber, t]);

  const columns = [
    { key: 'line_number', label: t('orders.detail.lineNo'), align: 'right' },
    { key: 'sku', label: t('orders.detail.sku'), mono: true },
    { key: 'item_name', label: t('orders.detail.itemName') },
    { key: 'quantity_ordered', label: t('orders.detail.ordered'), align: 'right', render: (r) => formatNumber(r.quantity_ordered) },
    { key: 'quantity_picked', label: t('orders.detail.picked'), align: 'right', render: (r) => formatNumber(r.quantity_picked) },
    { key: 'quantity_shipped', label: t('orders.detail.shipped'), align: 'right', render: (r) => formatNumber(r.quantity_shipped) },
    { key: 'status', label: t('orders.detail.status'), render: (r) => <StatusTag status={r.status} /> },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="mono">{soNumber}</h1>
        <Link className="btn btn-sm" to="/orders">{t('orders.detail.back')}</Link>
      </div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {loading && <div className="card-note">{t('orders.detail.loading')}</div>}
      {order && (
        <>
          <div className="card detail-grid">
            <div><span>{t('orders.detail.status')}</span><StatusTag status={order.status} /></div>
            <div><span>{t('orders.detail.orderDate')}</span><strong>{formatDate(order.order_date)}</strong></div>
            <div><span>{t('orders.detail.shipBy')}</span><strong>{formatDate(order.ship_by_date)}</strong></div>
            <div><span>{t('orders.detail.warehouse')}</span><strong className="mono">{order.warehouse_code}</strong></div>
            <div><span>{t('orders.detail.shipMethod')}</span><strong>{order.ship_method || '—'}</strong></div>
            <div><span>{t('orders.detail.origin')}</span><strong>{order.order_origin || '—'}</strong></div>
            <div className="detail-wide"><span>{t('orders.detail.shipAddress')}</span><strong>{order.ship_address || '—'}</strong></div>
            {order.memo && <div className="detail-wide"><span>{t('orders.detail.memo')}</span><strong>{order.memo}</strong></div>}
          </div>
          <div className="card">
            <h2 className="card-title">{t('orders.detail.lines')}</h2>
            <DataTable
              columns={columns}
              rows={order.lines}
              rowKey={(r) => r.line_number}
              empty={t('orders.detail.noLines')}
            />
          </div>
        </>
      )}
    </div>
  );
}
