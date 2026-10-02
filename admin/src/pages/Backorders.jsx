import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import RichText from '../i18n/RichText.jsx';
import { useLocale } from '../i18n/locale.jsx';

// Partial-fulfill / backorders dashboard. Two tabs:
//   Waiting       - status=WAITING_STOCK, oldest backorder_opened_at
//                   surfaces first so a long-tail backorder is not
//                   buried under a fresh one.
//   Ready to ship - status IN (OPEN, PICKED, PACKED) with
//                   backorder_opened_at IS NOT NULL. These have been
//                   flipped to OPEN by the receipt-hook matcher and
//                   are eligible for the next pick batch.
// Click row opens the existing SO edit modal via
// /sales-orders?focus=<so_number>; the SO page reads the focus query
// param and pops the modal in-place.

// These two tables live at module scope, so they cannot call the hook.
// They carry keys and the render resolves them; the alternative --
// moving them inside the component -- would rebuild both arrays on
// every keystroke in the modal.
const TABS = [
  { key: 'waiting', labelKey: 'backorders.tabWaiting' },
  { key: 'ready-to-ship', labelKey: 'backorders.tabReady' },
];

const CANCEL_REASONS = [
  { value: 'found', labelKey: 'backorders.reasonFound' },
  { value: 'customer_asked', labelKey: 'backorders.reasonCustomerAsked' },
  { value: 'refunded', labelKey: 'backorders.reasonRefunded' },
  { value: 'other', labelKey: 'backorders.reasonOther' },
];

/** Cancellation reason value -> its message key, for the banner. */
const REASON_KEY = Object.fromEntries(
  CANCEL_REASONS.map((r) => [r.value, r.labelKey]),
);


function ItemsCell({ items }) {
  const { t } = useLocale();
  if (!items || items.length === 0) {
    return <span style={{ color: 'var(--text-secondary)' }}>{t('backorders.noItems')}</span>;
  }
  return (
    <div style={{ fontSize: 12, lineHeight: 1.4 }}>
      {items.map((it, i) => (
        <div key={i}>
          <span className="mono">{it.sku}</span>
          {' × '}
          {it.qty}
        </div>
      ))}
    </div>
  );
}


export default function Backorders() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const [tab, setTab] = useState('waiting');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [successBanner, setSuccessBanner] = useState('');

  // Cancel-BO confirm modal state. cancelTarget holds the BO row
  // being cancelled; cancelReason is a dropdown enum mirroring the
  // backend's CANCEL_REASONS.
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('other');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setActionError('');
    const qs = new URLSearchParams({ tab });
    if (warehouseId) qs.set('warehouse_id', String(warehouseId));
    const res = await api.get(`/admin/backorders?${qs.toString()}`);
    if (res?.ok) {
      const data = await res.json();
      setRows(data.backorders || []);
    } else {
      setRows([]);
      setActionError(t('backorders.loadFailed'));
    }
    setLoading(false);
  }, [t, tab, warehouseId]);

  useEffect(() => { load(); }, [load]);

  function openCancel(row) {
    setCancelTarget(row);
    setCancelReason('other');
    setCancelError('');
  }

  function closeCancel() {
    setCancelTarget(null);
    setCancelReason('other');
    setCancelError('');
    setCancelSubmitting(false);
  }

  async function submitCancel() {
    if (!cancelTarget) return;
    setCancelSubmitting(true);
    setCancelError('');
    const res = await api.post(
      `/admin/sales-orders/${cancelTarget.so_id}/cancel-backorder`,
      { cancellation_reason: cancelReason },
    );
    setCancelSubmitting(false);
    if (!res?.ok) {
      let data = null;
      try { data = await res?.json(); } catch (_) { /* non-JSON */ }
      setCancelError(data?.error || t('backorders.cancelFailed'));
      return;
    }
    const soNumber = cancelTarget.so_number;
    closeCancel();
    setSuccessBanner(t('backorders.cancelled', {
      so: soNumber,
      reason: t(REASON_KEY[cancelReason] ?? 'backorders.reasonOther'),
    }));
    setTimeout(() => setSuccessBanner(''), 6000);
    load();
  }

  // Both tabs share a base column set; ready-to-ship adds
  // "Fulfillable since" so the operator can prioritise the longest-
  // waiting ready batch first.
  const baseColumns = [
    { key: 'so_number', labelKey: 'backorders.number', mono: true },
    { key: 'parent_so_number', labelKey: 'backorders.parentSo', mono: true,
      render: (r) => r.parent_so_number || <span style={{ color: 'var(--text-secondary)' }}>-</span> },
    { key: 'customer_name', labelKey: 'common.customer',
      render: (r) => r.customer_name || <span style={{ color: 'var(--text-secondary)' }}>-</span> },
    { key: 'items', labelKey: 'backorders.items', render: (r) => <ItemsCell items={r.items} /> },
    { key: 'days_waiting', labelKey: 'backorders.daysWaiting',
      render: (r) => (
        <span className="mono">
          {r.days_waiting}
        </span>
      ),
    },
  ];

  const readyColumn = {
    key: 'fulfillable_since',
    labelKey: 'backorders.fulfillableSince',
    render: (r) => r.fulfillable_since
      ? new Date(r.fulfillable_since).toLocaleDateString()
      : <span style={{ color: 'var(--text-secondary)' }}>-</span>,
  };

  const actionsColumn = {
    key: 'actions',
    label: '',
    render: (r) => (
      <button
        className="btn btn-sm btn-danger"
        onClick={(e) => { e.stopPropagation(); openCancel(r); }}
        title={t('backorders.cancelTooltip')}
      >
        {t('common.cancel')}
      </button>
    ),
  };

  const columns = tab === 'ready-to-ship'
    ? [...baseColumns, readyColumn, actionsColumn]
    : [...baseColumns, actionsColumn];

  function openRowInSalesOrders(row) {
    // The SO list page reads ?focus=<so_number> to auto-open the
    // edit modal for that row. Mirrors the deep-link pattern the
    // Teams adaptive card uses so /backorders -> click -> SO modal
    // is the same path as Teams ping -> Open in Sơn Lộc WMS -> SO modal.
    navigate(`/sales-orders?focus=${encodeURIComponent(row.so_number)}`);
  }

  return (
    <div>
      <PageHeader title={t('nav.backorders')} />
      {successBanner && (
        <div
          role="status"
          style={{
            margin: '0 0 12px 0',
            padding: '8px 12px',
            background: 'var(--success-bg)',
            color: 'var(--success)',
            border: '1px solid var(--success)',
            borderRadius: 4,
            fontSize: 13,
          }}
        >
          {successBanner}
        </div>
      )}
      {actionError && (
        <div className="form-error" style={{ marginBottom: 12 }}>{actionError}</div>
      )}
      <div className="section">
        <div role="tablist" style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {/* The map used to bind `t`, which now names the translator. */}
          {TABS.map((item) => (
            <button
              key={item.key}
              role="tab"
              aria-selected={tab === item.key}
              className={`btn ${tab === item.key ? 'btn-primary' : ''}`}
              onClick={() => setTab(item.key)}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          emptyMessageKey={tab === 'waiting'
            ? 'backorders.emptyWaiting'
            : 'backorders.emptyReady'}
          onRowClick={openRowInSalesOrders}
        />
      </div>

      {cancelTarget && (
        <Modal
          title={t('backorders.cancelTitle', { so: cancelTarget.so_number })}
          onClose={closeCancel}
          footer={
            <>
              <button className="btn" onClick={closeCancel} disabled={cancelSubmitting}>
                {t('backorders.keep')}
              </button>
              <button
                className="btn btn-danger"
                onClick={submitCancel}
                disabled={cancelSubmitting}
              >
                {cancelSubmitting
                  ? t('backorders.cancelling')
                  : t('backorders.cancelConfirm')}
              </button>
            </>
          }
        >
          {cancelError && (
            <div className="form-error" style={{ marginBottom: 12 }}>{cancelError}</div>
          )}
          <p style={{ fontSize: 13, marginBottom: 12 }}>
            <RichText
              text={t('backorders.cancelWarning')}
              values={{
                so: <strong>{cancelTarget.so_number}</strong>,
                parent: <span className="mono">{cancelTarget.parent_so_number}</span>,
              }}
            />
          </p>
          <div className="form-group">
            <label>{t('backorders.reason')}</label>
            <select
              className="form-select"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            >
              {CANCEL_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{t(r.labelKey)}</option>
              ))}
            </select>
          </div>
        </Modal>
      )}
    </div>
  );
}
