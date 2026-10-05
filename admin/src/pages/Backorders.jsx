import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import RichText from '../i18n/RichText.jsx';
import { useLocale } from '../i18n/locale.jsx';
import SalesOrderModal from '../components/SalesOrderModal.jsx';
// expected_date is a date-only string. new Date('2026-08-25') parses as UTC
// midnight and renders a day early west of it, which is the bug this helper
// exists to avoid.
import { formatDateOnly } from '../utils/date.js';

// Partial-fulfill / backorders dashboard. Two tabs:
//   Waiting       - status=WAITING_STOCK, oldest backorder_opened_at
//                   surfaces first so a long-tail backorder is not
//                   buried under a fresh one.
//   Ready to ship - status IN (OPEN, PICKED, PACKED) with
//                   backorder_opened_at IS NOT NULL. These have been
//                   flipped to OPEN by the receipt-hook matcher and
//                   are eligible for the next pick batch.
//
// Issue : clicking a row used to navigate to /sales-orders?focus=,
// so working a queue cost one navigation away and one back per order,
// and the return always landed on the Waiting tab. The order now opens
// in a modal on this page, and the tab lives in the URL so it survives
// navigation and can be linked to.

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


// The operator asked for a way to tell whether the item has already
// been ordered. open_po is derived (no backorder-to-PO link exists), so it
// names the PO it is claiming rather than showing a bare checkbox. Null is
// rendered explicitly: "no open PO" has to read differently from a field that
// did not load.
function OrderedLine({ openPo }) {
  const { t } = useLocale();
  if (!openPo) return <div>{t('backorders.notOnOpenPo')}</div>;
  const po = <span className="mono">{openPo.po_number}</span>;
  return (
    <div>
      {openPo.expected_date
        ? <RichText text={t('backorders.onPoExpected', { date: formatDateOnly(openPo.expected_date) })} values={{ po }} />
        : <RichText text={t('backorders.onPoNoDate')} values={{ po }} />}
    </div>
  );
}

// a SKU alone is not enough to know what you are looking at when
// working the queue, so the name sits under the mono SKU line.
function ItemsCell({ items }) {
  const { t } = useLocale();
  if (!items || items.length === 0) {
    return <span style={{ color: 'var(--text-secondary)' }}>{t('backorders.noItems')}</span>;
  }
  return (
    <div style={{ fontSize: 12, lineHeight: 1.4 }}>
      {items.map((it, i) => (
        <div key={i} style={i > 0 ? { marginTop: 6 } : undefined}>
          <div>
            <span className="mono">{it.sku}</span>
            {' × '}
            {it.qty}
          </div>
          {it.item_name && <div>{it.item_name}</div>}
          <OrderedLine openPo={it.open_po} />
        </div>
      ))}
    </div>
  );
}


export default function Backorders() {
  const { t } = useLocale();
  const { warehouseId } = useWarehouse();
  // : the tab lives in the URL, not local state, so returning to this
  // page (or sharing the link) keeps the operator on the queue they were
  // working instead of resetting to Waiting. An unknown ?tab= falls back
  // rather than rendering an empty grid against a tab the API rejects.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam : 'waiting';

  function setTab(key) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    // replace, not push: flipping tabs should not stack history entries
    // the operator has to click back through.
    setSearchParams(next, { replace: true });
  }

  // Which backorder is open in the shared SO modal. Read-only view, the
  // same surface a row click gives on the Sales Orders page.
  const [openSoId, setOpenSoId] = useState(null);
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

  // : open the order here rather than navigating to the Sales Orders
  // page. The operator keeps their tab, their scroll position and their
  // place in the queue.
  function openRow(row) {
    setOpenSoId(row.so_id);
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
          rowKey="so_id"
          columns={columns}
          data={rows}
          loading={loading}
          emptyMessageKey={tab === 'waiting'
            ? 'backorders.emptyWaiting'
            : 'backorders.emptyReady'}
          onRowClick={openRow}
          clickColumn="so_number"
        />
      </div>

      <SalesOrderModal
        soId={openSoId}
        mode="view"
        onClose={() => setOpenSoId(null)}
        onChanged={(payload) => {
          // An edit made inside the modal can move a backorder off the tab
          // being viewed (a WAITING_STOCK order flipped to OPEN leaves
          // Waiting), so the queue reloads rather than going stale.
          load();
          if (payload?.message) {
            setSuccessBanner(payload.message);
            setTimeout(() => setSuccessBanner(''), 6000);
          }
        }}
      />

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
