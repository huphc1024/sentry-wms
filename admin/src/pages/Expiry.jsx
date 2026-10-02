import { useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import { useLocale } from '../i18n/locale.jsx';
import RichText from '../i18n/RichText.jsx';

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateValue}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

function ExpiryBadge({ expiryDate }) {
  const { t } = useLocale();
  const days = daysUntil(expiryDate);
  const expired = days < 0;
  return (
    <span className={`expiry-badge ${expired ? 'expiry-badge-danger' : 'expiry-badge-warning'}`}>
      {expired
        ? t('expiry.overdueDays', { days: Math.abs(days) })
        : (days === 0
          ? t('expiry.dueToday')
          : t('expiry.daysLeft', { days }))}
    </span>
  );
}

export default function Expiry() {
  const { t } = useLocale();
  const { warehouseId, warehouse } = useWarehouse();
  const [near, setNear] = useState([]);
  const [expired, setExpired] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [extendDate, setExtendDate] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    setLoading(true);
    setNotice(null);
    try {
      const [nearResponse, expiredResponse] = await Promise.all([
        api.get(`/expiry/near?warehouse_id=${warehouseId}&days=14`),
        api.get(`/expiry/expired?warehouse_id=${warehouseId}`),
      ]);
      if (!nearResponse?.ok || !expiredResponse?.ok) {
        const failed = !nearResponse?.ok ? nearResponse : expiredResponse;
        const body = await failed?.json().catch(() => ({}));
        throw new Error(body?.error || 'Không thể tải dữ liệu hạn sử dụng');
      }
      const [nearData, expiredData] = await Promise.all([
        nearResponse.json(),
        expiredResponse.json(),
      ]);
      setNear(nearData.near_expiry || []);
      setExpired(expiredData.expired || []);
      setSelected(new Set());
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  }, [warehouseId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(load, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const rows = useMemo(() => [
    ...expired.map((row) => ({ ...row, expiryState: 'expired' })),
    ...near.map((row) => ({ ...row, expiryState: 'near' })),
  ], [expired, near]);
  const selectedIds = useMemo(
    () => rows.filter((row) => selected.has(row.pallet_id)).map((row) => row.pallet_id),
    [rows, selected],
  );
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggleSelect(palletId) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(palletId)) next.delete(palletId);
      else next.add(palletId);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.pallet_id)));
  }

  async function executeAction() {
    const action = confirmAction;
    setConfirmAction(null);
    setLoading(true);
    setNotice(null);
    try {
      let response;
      if (action === 'dispose') {
        response = await api.post('/expiry/dispose', { pallet_ids: selectedIds });
      } else if (action === 'policy') {
        response = await api.post('/expiry/dispose', { warehouse_id: warehouseId });
      } else if (action === 'extend') {
        response = await api.post('/expiry/extend', {
          pallet_ids: selectedIds,
          expiry_date: extendDate,
        });
      }
      if (!response?.ok) {
        const body = await response?.json().catch(() => ({}));
        throw new Error(body?.error || 'Thao tác không thành công');
      }
      const body = await response.json();
      setNotice({ type: 'success', message: body.message || t('expiry.updated') });
      setSelected(new Set());
      setExtendDate('');
      await load();
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  }

  function requestExtend() {
    if (!selected.size) {
      setNotice({ type: 'error', message: t('expiry.pickAtLeastOne') });
      return;
    }
    if (!extendDate) {
      setNotice({ type: 'error', message: t('expiry.pickNewDate') });
      return;
    }
    setConfirmAction('extend');
  }

  return (
    <div className="expiry-page">
      <PageHeader title={t('nav.expiry')}>
        <button className="btn" onClick={load} disabled={loading}>
          {t(loading ? 'common.loading' : 'common.refresh')}
        </button>
        <button className="btn btn-danger" onClick={() => setConfirmAction('policy')} disabled={loading || !warehouseId}>
          {t('expiry.runPolicy')}
        </button>
      </PageHeader>

      {!warehouseId ? (
        <div className="expiry-empty">{t('expiry.pickWarehouse')}</div>
      ) : (
        <>
          <div className="expiry-summary" aria-label={t('expiry.summaryLabel')}>
            <div className="expiry-stat">
              <span>{t('expiry.currentWarehouse')}</span>
              <strong>{warehouse?.warehouse_code || `#${warehouseId}`}</strong>
            </div>
            <div className="expiry-stat expiry-stat-warning">
              <span>{t('expiry.nearExpiry')}</span>
              <strong>{near.length}</strong>
            </div>
            <div className="expiry-stat expiry-stat-danger">
              <span>{t('expiry.overdue')}</span>
              <strong>{expired.length}</strong>
            </div>
            <div className="expiry-stat">
              <span>{t('expiry.selected')}</span>
              <strong>{selected.size}</strong>
            </div>
          </div>

          {notice && (
            <div className={`expiry-notice expiry-notice-${notice.type}`} role="status">
              {notice.message}
            </div>
          )}

          <div className="expiry-toolbar">
            <div>
              <strong>
                {selected.size
                  ? t('expiry.nSelected', { n: selected.size })
                  : t('expiry.pickForBulk')}
              </strong>
              <span>{t('expiry.extendSyncNote')}</span>
            </div>
            <label className="expiry-date-field">
              <span>{t('expiry.newExpiryDate')}</span>
              <input
                className="form-input"
                type="date"
                value={extendDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setExtendDate(event.target.value)}
              />
            </label>
            <button className="btn" onClick={requestExtend} disabled={loading || !selected.size}>
              {t('expiry.extendSelected')}
            </button>
            <button
              className="btn btn-danger"
              onClick={() => setConfirmAction('dispose')}
              disabled={loading || !selected.size}
            >
              {t('expiry.disposeSelected')}
            </button>
          </div>

          <div className="expiry-table-card">
            <div className="expiry-table-heading">
              <div>
                <h2>{t('expiry.palletsToHandle')}</h2>
                <p>{t('expiry.fefoNote')}</p>
              </div>
              <span>{rows.length} pallet</span>
            </div>
            {rows.length === 0 && !loading ? (
              <div className="expiry-empty">{t('expiry.none')}</div>
            ) : (
              <div className="expiry-table-scroll">
                <table className="data-table expiry-table">
                  <thead>
                    <tr>
                      <th className="expiry-check-cell">
                        <input
                          type="checkbox"
                          aria-label={t('expiry.selectAll')}
                          checked={allSelected}
                          onChange={toggleAll}
                        />
                      </th>
                      <th>{t('warehouseSimulation.pallet')}</th>
                      <th>{t('common.sku')}</th>
                      <th>{t('common.bin')}</th>
                      <th>{t('common.qty')}</th>
                      <th>{t('expiry.expiryDate')}</th>
                      <th>{t('common.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.pallet_id} className={selected.has(row.pallet_id) ? 'selected' : ''}>
                        <td className="expiry-check-cell">
                          <input
                            type="checkbox"
                            aria-label={t('expiry.selectPallet', {
                              code: row.pallet_code || row.pallet_id,
                            })}
                            checked={selected.has(row.pallet_id)}
                            onChange={() => toggleSelect(row.pallet_id)}
                          />
                        </td>
                        <td className="mono">{row.pallet_code || `#${row.pallet_id}`}</td>
                        <td className="mono">{row.sku || '—'}</td>
                        <td className="mono">{row.bin_id || '—'}</td>
                        <td>{row.quantity}</td>
                        <td className="mono">{row.expiry_date}</td>
                        <td><ExpiryBadge expiryDate={row.expiry_date} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {confirmAction && (
        <Modal
          title={
            confirmAction === 'dispose'
              ? t('expiry.confirmDispose')
              : confirmAction === 'extend'
                ? t('expiry.confirmExtend')
                : t('expiry.runPolicyTitle')
          }
          onClose={() => setConfirmAction(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmAction(null)}>{t('common.cancel')}</button>
              <button
                className={confirmAction === 'extend' ? 'btn btn-primary' : 'btn btn-danger'}
                onClick={executeAction}
              >
                {t(confirmAction === 'extend' ? 'expiry.extend' : 'common.confirm')}
              </button>
            </>
          }
        >
          {confirmAction === 'dispose' && (
            <p>{t('expiry.disposeExplain', { n: selected.size })}</p>
          )}
          {confirmAction === 'extend' && (
            <p>
              <RichText
                text={t('expiry.extendExplain', { n: selected.size })}
                values={{ date: <strong>{extendDate}</strong> }}
              />
            </p>
          )}
          {confirmAction === 'policy' && (
            <p>
              <RichText
                text={t('expiry.policyExplain')}
                values={{
                  warehouse: <strong>{warehouse?.warehouse_code || warehouseId}</strong>,
                }}
              />
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

