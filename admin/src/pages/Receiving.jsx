import { useState, useEffect, Fragment } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusTag from '../components/StatusTag.jsx';
import Modal from '../components/Modal.jsx';
import { useLocale } from '../i18n/locale.jsx';
import RichText from '../i18n/RichText.jsx';

// /api/receiving/receive only accepts OPEN or PARTIAL POs. Mirror
// that constraint in the UI so the operator never sees a 400 from
// the server for a finished PO.
const RECEIVABLE_PO_STATUSES = new Set(['OPEN', 'PARTIAL']);

export default function Receiving() {
  const { t } = useLocale();
  const [pos, setPos] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [statusFilter, setStatusFilter] = useState('active');
  // Bins scoped to the selected PO's warehouse; populated when a PO
  // is opened. Receive form's bin dropdown reads from here.
  const [warehouseBins, setWarehouseBins] = useState([]);
  const [defaultBinId, setDefaultBinId] = useState(null);
  // Per-line draft state: { [po_line_id]: { qty, bin_id, error, saving } }
  const [lineDrafts, setLineDrafts] = useState({});
  // Receipt history (the item_receipts rows for the PO) and the
  // per-line expand state. Each line shows a "Receipts (N)" toggle;
  // clicking it surfaces the rows + per-row Unreceive buttons. Loaded
  // alongside the PO detail so the toggle is a pure UI operation.
  const [receipts, setReceipts] = useState([]);
  const [expandedLines, setExpandedLines] = useState(new Set());
  // Unreceive confirm state. unreceiving holds the receipt row being
  // reversed; unreceiveReason is the free-text the operator types
  // (sent to the backend, capped server-side at 500 chars).
  const [unreceiving, setUnreceiving] = useState(null);
  const [unreceiveReason, setUnreceiveReason] = useState('');
  const [unreceiveError, setUnreceiveError] = useState('');
  const [unreceiveSubmitting, setUnreceiveSubmitting] = useState(false);

  useEffect(() => {
    loadPOs();
  }, [statusFilter]);

  async function loadPOs() {
    if (statusFilter === 'active') {
      const [openRes, partialRes] = await Promise.all([
        api.get('/admin/purchase-orders?status=OPEN&per_page=50'),
        api.get('/admin/purchase-orders?status=PARTIAL&per_page=50'),
      ]);
      const all = [];
      for (const res of [openRes, partialRes]) {
        if (res?.ok) {
          const data = await res.json();
          all.push(...(data.purchase_orders || []));
        }
      }
      setPos(all);
    } else {
      const params = new URLSearchParams({ per_page: 50 });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await api.get(`/admin/purchase-orders?${params}`);
      if (res?.ok) {
        const data = await res.json();
        setPos(data.purchase_orders || []);
      }
    }
  }

  async function viewPO(po) {
    setSelected(po);
    const id = po.po_id || po.id;
    const res = await api.get(`/admin/purchase-orders/${id}`);
    if (!res?.ok) return;
    const data = await res.json();
    setDetail(data);

    const warehouseId = data.purchase_order?.warehouse_id;
    if (warehouseId) {
      const binsRes = await api.get(
        `/admin/bins?warehouse_id=${warehouseId}&per_page=500`,
      );
      if (binsRes?.ok) {
        const bdata = await binsRes.json();
        const bins = bdata.bins || [];
        setWarehouseBins(bins);
        // Default to the first Staging bin in the warehouse so the
        // common receive-to-staging-then-putaway flow is one click.
        // Fall back to the first bin overall if no Staging bins
        // exist (small / unusual warehouse layouts).
        const staging = bins.find((b) => b.bin_type === 'Staging');
        const fallback = bins[0];
        setDefaultBinId((staging || fallback)?.bin_id || null);
      } else {
        setWarehouseBins([]);
        setDefaultBinId(null);
      }
    }
    setLineDrafts({});
    await loadReceipts(id);
  }

  function closeDetail() {
    setSelected(null);
    setDetail(null);
    setWarehouseBins([]);
    setDefaultBinId(null);
    setLineDrafts({});
    setReceipts([]);
    setExpandedLines(new Set());
  }

  async function refreshDetail() {
    if (!detail?.purchase_order) return;
    const po_id = detail.purchase_order.po_id;
    const res = await api.get(`/admin/purchase-orders/${po_id}`);
    if (res?.ok) {
      setDetail(await res.json());
    }
    await loadReceipts(po_id);
  }

  async function loadReceipts(po_id) {
    const res = await api.get(`/admin/purchase-orders/${po_id}/receipts`);
    if (res?.ok) {
      const data = await res.json();
      setReceipts(data.receipts || []);
    } else {
      setReceipts([]);
    }
  }

  function toggleLineReceipts(lineId) {
    setExpandedLines((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId); else next.add(lineId);
      return next;
    });
  }

  function openUnreceive(receipt) {
    setUnreceiveReason('');
    setUnreceiveError('');
    setUnreceiving(receipt);
  }

  function closeUnreceive() {
    setUnreceiving(null);
    setUnreceiveReason('');
    setUnreceiveError('');
    setUnreceiveSubmitting(false);
  }

  async function submitUnreceive() {
    if (!unreceiving) return;
    setUnreceiveError('');
    setUnreceiveSubmitting(true);
    try {
      const body = {};
      if (unreceiveReason.trim()) body.reason = unreceiveReason.trim();
      const res = await api.post(
        `/admin/receipts/${unreceiving.receipt_id}/unreceive`,
        body,
      );
      if (!res?.ok) {
        let data = null;
        try { data = await res?.json(); } catch (_) { /* non-JSON */ }
        setUnreceiveError(data?.error || 'Failed to reverse receipt');
        return;
      }
      closeUnreceive();
      await refreshDetail();
      loadPOs();
    } finally {
      setUnreceiveSubmitting(false);
    }
  }

  function updateDraft(lineId, patch) {
    setLineDrafts((d) => ({
      ...d,
      [lineId]: { ...(d[lineId] || {}), ...patch },
    }));
  }

  async function receiveLine(line) {
    const draft = lineDrafts[line.po_line_id] || {};
    const qty = parseInt(draft.qty, 10);
    const binId = parseInt(draft.bin_id ?? defaultBinId, 10);
    if (isNaN(qty) || qty <= 0) {
      updateDraft(line.po_line_id, { error: t('salesOrders.enterQty') });
      return;
    }
    if (!binId) {
      updateDraft(line.po_line_id, { error: t('receiving.pickBin') });
      return;
    }
    updateDraft(line.po_line_id, { saving: true, error: '' });
    const res = await api.post('/receiving/receive', {
      po_id: detail.purchase_order.po_id,
      items: [{ item_id: line.item_id, quantity: qty, bin_id: binId }],
    });
    if (res?.ok) {
      // Clear this line's draft and pull the updated PO so the
      // received counter + status reflect the change.
      setLineDrafts((d) => {
        const next = { ...d };
        delete next[line.po_line_id];
        return next;
      });
      await refreshDetail();
      loadPOs();
    } else {
      const data = await res?.json();
      updateDraft(line.po_line_id, {
        saving: false,
        error: data?.error || 'Failed to receive',
      });
    }
  }

  const columns = [
    { key: 'po_number', labelKey: 'purchaseOrders.number', mono: true },
    { key: 'vendor_name', labelKey: 'common.vendor' },
    { key: 'expected_date', labelKey: 'purchaseOrders.expectedDate', mono: true, render: (r) => r.expected_date || '-' },
    { key: 'status', labelKey: 'common.status', render: (r) => <StatusTag status={r.status} /> },
  ];

  const po = detail?.purchase_order;
  const canReceive = po && RECEIVABLE_PO_STATUSES.has(po.status);

  return (
    <div>
      <PageHeader title={t('nav.receiving')} />
      <div className="filter-bar">
        <select className="form-select" style={{ width: 140 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="active">{t('receiving.openOrPartial')}</option>
          <option value="all">{t('common.all')}</option>
          <option value="OPEN">{t('status.OPEN')}</option>
          <option value="PARTIAL">{t('status.PARTIAL')}</option>
          <option value="RECEIVED">{t('status.RECEIVED')}</option>
          <option value="CLOSED">{t('status.CLOSED')}</option>
        </select>
      </div>
      <DataTable rowKey="po_id" columns={columns} data={pos} onRowClick={viewPO} emptyMessageKey="receiving.noPos" />

      {selected && detail && (
        <Modal
          title={t('receiving.poTitle', { po: po?.po_number || selected.po_number })}
          onClose={closeDetail}
          footer={<button className="btn" onClick={closeDetail}>{t('common.close')}</button>}
          size="wide"
        >
          <section className="section">
            <div className="section-title">{t('purchaseOrders.summary')}</div>
            <div className="detail-grid detail-grid-2col" style={{ marginBottom: 0 }}>
              <span className="detail-label">{t('common.vendor')}</span><span>{po?.vendor_name || '-'}</span>
              <span className="detail-label">{t('common.status')}</span><span><StatusTag status={po?.status} /></span>
              <span className="detail-label">{t('purchaseOrders.expectedDate')}</span><span className="mono">{po?.expected_date || '-'}</span>
              <span className="detail-label">{t('common.warehouse')}</span><span className="mono">{po?.warehouse_id ?? '-'}</span>
            </div>
          </section>

          <section className="section" style={{ marginBottom: 0 }}>
            <div className="section-title">{t('salesOrders.lineItems')}</div>
            {!canReceive && (
              <p style={{
                fontSize: 12, color: 'var(--text-secondary)',
                marginBottom: 8, fontStyle: 'italic',
              }}>
                {t('receiving.disabledHint', { status: po?.status })}
              </p>
            )}
            {(detail.lines || []).length > 0 ? (
              <table className="lines-table">
                <thead>
                  <tr>
                    <th>{t('common.sku')}</th>
                    <th>{t('common.upc')}</th>
                    <th>{t('receiving.mpn')}</th>
                    <th>{t('common.item')}</th>
                    <th style={{ textAlign: 'right' }}>{t('salesOrders.ordered')}</th>
                    <th style={{ textAlign: 'right' }}>{t('purchaseOrders.received')}</th>
                    <th style={{ textAlign: 'right' }}>{t('purchaseOrders.remaining')}</th>
                    {canReceive && (
                      <>
                        <th style={{ width: 90, textAlign: 'right' }}>{t('common.qty')}</th>
                        <th style={{ width: 220 }}>{t('common.bin')}</th>
                        <th style={{ width: 110 }}></th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {(detail.lines || []).map((l) => {
                    const remaining = (l.quantity_ordered || 0) - (l.quantity_received || 0);
                    const draft = lineDrafts[l.po_line_id] || {};
                    const lineReceivable = canReceive && remaining > 0;
                    const lineReceipts = receipts.filter((r) => r.po_line_id === l.po_line_id);
                    const isExpanded = expandedLines.has(l.po_line_id);
                    return (
                      <Fragment key={l.po_line_id}>
                        <tr>
                          <td className="mono">{l.sku}</td>
                          <td className="mono">{l.upc || '-'}</td>
                          <td className="mono">{l.mpn || '-'}</td>
                          <td style={{ color: 'var(--text-secondary)' }}>
                            {l.item_name}
                            {lineReceipts.length > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleLineReceipts(l.po_line_id)}
                                style={{
                                  marginLeft: 8,
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--accent)',
                                  cursor: 'pointer',
                                  fontSize: 12,
                                  textDecoration: 'underline',
                                  padding: 0,
                                }}
                                title={isExpanded
                                  ? 'Hide receipt history'
                                  : 'Show receipt history (with Unreceive)'}
                              >
                                {t(isExpanded
                                  ? 'receiving.hideReceipts'
                                  : 'receiving.showReceipts', { n: lineReceipts.length })}
                              </button>
                            )}
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>{l.quantity_ordered}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{l.quantity_received}</td>
                          <td className="mono" style={{
                            textAlign: 'right',
                            color: remaining > 0 ? 'var(--copper)' : 'var(--text-secondary)',
                            fontWeight: remaining > 0 ? 600 : 400,
                          }}>{remaining}</td>
                          {canReceive && (
                            <>
                              <td style={{ textAlign: 'right' }}>
                                <input
                                  type="number" min={1} max={remaining}
                                  className="form-input mono"
                                  style={{ width: 76, textAlign: 'right', padding: '4px 8px' }}
                                  value={draft.qty ?? ''}
                                  disabled={!lineReceivable || draft.saving}
                                  placeholder={lineReceivable ? '0' : ''}
                                  onChange={(e) => updateDraft(l.po_line_id, { qty: e.target.value })}
                                />
                              </td>
                              <td>
                                <select
                                  className="form-select"
                                  style={{ padding: '4px 8px' }}
                                  value={draft.bin_id ?? defaultBinId ?? ''}
                                  disabled={!lineReceivable || draft.saving}
                                  onChange={(e) => updateDraft(l.po_line_id, { bin_id: e.target.value })}
                                >
                                  {warehouseBins.map((b) => (
                                    <option key={b.bin_id} value={b.bin_id}>
                                      {b.bin_code}{b.bin_type ? ` (${b.bin_type})` : ''}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <button
                                  className="btn btn-sm btn-primary"
                                  disabled={!lineReceivable || draft.saving}
                                  onClick={() => receiveLine(l)}
                                >
                                  {t(draft.saving ? 'receiving.receiving' : 'receiving.receive')}
                                </button>
                              </td>
                            </>
                          )}
                        </tr>
                        {/* Expanded receipt history for this line.
                            Each row shows the receipt's qty, bin,
                            receiver, and an Unreceive button that
                            opens the confirm modal. */}
                        {isExpanded && lineReceipts.map((r) => (
                          <tr key={`receipt-${r.receipt_id}`} style={{ background: 'var(--surface)' }}>
                            <td colSpan={3}></td>
                            <td colSpan={canReceive ? 6 : 3} style={{ fontSize: 12 }}>
                              <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                                {r.received_at ? new Date(r.received_at).toLocaleString() : '-'}
                              </span>
                              {' - '}
                              <strong>{r.quantity_received}</strong> units to bin{' '}
                              <span className="mono">{r.bin_code}</span>
                              {r.received_by ? (
                                <>
                                  {' '}
                                  <RichText
                                    text={t('receiving.byWhom')}
                                    values={{ who: <strong>{r.received_by}</strong> }}
                                  />
                                </>
                              ) : null}
                              {r.lot_number
                                ? ` (${t('warehouseSimulation.lotN', { lot: r.lot_number })})`
                                : null}
                              {r.serial_number
                                ? ` (${t('receiving.serialN', { serial: r.serial_number })})`
                                : null}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                className="btn btn-sm btn-danger"
                                onClick={() => openUnreceive(r)}
                                title={t('receiving.reverseTooltip')}
                              >
                                {t('receiving.unreceive')}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                  {Object.entries(lineDrafts).filter(([, d]) => d.error).map(([lineId, d]) => (
                    <tr key={`err-${lineId}`}>
                      <td colSpan={canReceive ? 10 : 7}>
                        <div className="form-error" style={{ fontSize: 12, padding: '4px 0' }}>
                          {t('receiving.lineError', { line: lineId })} {d.error}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('salesOrders.noLineItems')}</p>
            )}
          </section>
        </Modal>
      )}

      {/* Unreceive confirm modal. The operator sees what they're about
          to back out (SKU, qty, bin, when, who) plus an optional
          free-text reason that lands in the ACTION_RECEIVE_CANCEL
          audit row + the receipt.cancelled event payload. */}
      {unreceiving && (
        <Modal
          title={t('receiving.unreceiveTitle', { sku: unreceiving.sku })}
          onClose={closeUnreceive}
          footer={
            <>
              <button
                className="btn"
                onClick={closeUnreceive}
                disabled={unreceiveSubmitting}
              >{t('common.cancel')}</button>
              <button
                className="btn btn-danger"
                onClick={submitUnreceive}
                disabled={unreceiveSubmitting}
              >
                {t(unreceiveSubmitting ? 'receiving.reversing' : 'receiving.unreceive')}
              </button>
            </>
          }
        >
          {unreceiveError && (
            <div className="form-error" style={{ marginBottom: 12 }}>{unreceiveError}</div>
          )}
          <p style={{ fontSize: 13, marginBottom: 12 }}>
            <RichText
              text={t('receiving.reverseExplain', { item: unreceiving.item_name })}
              values={{
                qty: <strong>{unreceiving.quantity_received}</strong>,
                sku: <span className="mono">{unreceiving.sku}</span>,
                bin: <span className="mono">{unreceiving.bin_code}</span>,
              }}
            />
            {unreceiving.received_at
              ? ` ${t('receiving.onWhen', {
                when: new Date(unreceiving.received_at).toLocaleString(),
              })}`
              : null}
            {unreceiving.received_by ? (
              <>
                {' '}
                <RichText
                  text={t('receiving.byWhom')}
                  values={{ who: <strong>{unreceiving.received_by}</strong> }}
                />
              </>
            ) : null}.
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
            {t('receiving.unreceiveExplain')}
          </p>
          <div className="form-group">
            <label>{t('receiving.reasonOptional')}</label>
            <input
              className="form-input"
              value={unreceiveReason}
              onChange={(e) => setUnreceiveReason(e.target.value)}
              placeholder={t('receiving.reasonExample')}
              maxLength={500}
              disabled={unreceiveSubmitting}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
