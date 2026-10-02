import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusTag from '../components/StatusTag.jsx';
import Modal from '../components/Modal.jsx';
import { useLocale } from '../i18n/locale.jsx';
import RichText from '../i18n/RichText.jsx';

// Outbound > Picking Batches. Lists the active (OPEN / IN_PROGRESS) pick
// batches -- the ones that hold the cross-pick lock -- so an admin can
// release a stuck one. A sales order is "locked" into picking only
// because it has a row in an active batch; nothing ages a batch out, so a
// failed pick round can strand its orders indefinitely. Delete here
// reuses the same unwind as the mobile cancel-batch flow: allocations
// freed, picked units restored to their source bins, batch CANCELLED, and
// the orders drop back to a clean pickable state.
//
// Delete is SO-only. TO batches are shown read-only: TO picking has no
// cross-pick lock (orders are never trapped) and a correct TO unwind
// needs work that lives on the Transfer Orders screen.

function formatAge(createdAt) {
  if (!createdAt) return '-';
  const ms = Date.now() - new Date(createdAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return '-';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function OrdersCell({ batch }) {
  const { t } = useLocale();
  if (batch.kind === 'TO') {
    return <span className="mono">{batch.to_number || '-'}</span>;
  }
  const orders = batch.orders || [];
  if (orders.length === 0) {
    return <span style={{ color: 'var(--text-secondary)' }}>{t('backorders.noItems')}</span>;
  }
  return (
    <div style={{ fontSize: 12, lineHeight: 1.4 }}>
      {orders.map((so) => (
        <div key={so} className="mono">{so}</div>
      ))}
    </div>
  );
}

export default function PickingBatches() {
  const { t } = useLocale();
  const { warehouseId } = useWarehouse();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [successBanner, setSuccessBanner] = useState('');

  // Delete confirm modal. deleteTarget holds the SO batch being released.
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const load = useCallback(async () => {
    if (!warehouseId) return;
    setLoading(true);
    setActionError('');
    const qs = new URLSearchParams({ warehouse_id: String(warehouseId) });
    const res = await api.get(`/admin/pick-batches?${qs.toString()}`);
    if (res?.ok) {
      const data = await res.json();
      setRows(data.pick_batches || []);
    } else {
      setRows([]);
      setActionError(t('pickingBatches.loadFailed'));
    }
    setLoading(false);
  }, [warehouseId]);

  useEffect(() => { load(); }, [load]);

  function openDelete(row) {
    setDeleteTarget(row);
    setDeleteError('');
  }

  function closeDelete() {
    setDeleteTarget(null);
    setDeleteError('');
    setDeleteSubmitting(false);
  }

  async function submitDelete() {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    setDeleteError('');
    const res = await api.post(`/admin/pick-batches/${deleteTarget.batch_id}/delete`, {});
    setDeleteSubmitting(false);
    if (!res?.ok) {
      let data = null;
      try { data = await res?.json(); } catch { /* non-JSON */ }
      setDeleteError(data?.detail || data?.error || 'Failed to release batch.');
      return;
    }
    let data = null;
    try { data = await res.json(); } catch { /* tolerate empty body */ }
    const freed = (data?.released_orders || []).join(', ');
    closeDelete();
    setSuccessBanner(
      freed
        ? t('pickingBatches.releasedWithFreed', {
          batch: deleteTarget.batch_number,
          freed,
        })
        : t('pickingBatches.released', { batch: deleteTarget.batch_number }),
    );
    setTimeout(() => setSuccessBanner(''), 8000);
    load();
  }

  const columns = [
    { key: 'batch_number', labelKey: 'pickingBatches.batchNumber', mono: true },
    {
      key: 'kind',
      labelKey: 'common.type',
      render: (r) => <StatusTag status={r.kind} />,
    },
    { key: 'orders', labelKey: 'pickingBatches.orders', render: (r) => <OrdersCell batch={r} /> },
    {
      key: 'assigned_to',
      labelKey: 'users.presetPicker',
      render: (r) => r.assigned_to || <span style={{ color: 'var(--text-secondary)' }}>-</span>,
    },
    {
      key: 'progress',
      labelKey: 'pickingBatches.progress',
      render: (r) => (
        <span className="mono">{r.completed_tasks}/{r.total_tasks}</span>
      ),
      csvValue: (r) => `${r.completed_tasks}/${r.total_tasks}`,
    },
    {
      key: 'created_at',
      labelKey: 'pickingBatches.age',
      render: (r) => (
        <span title={r.created_at ? new Date(r.created_at).toLocaleString() : ''}>
          {formatAge(r.created_at)}
        </span>
      ),
      csvValue: (r) => formatAge(r.created_at),
    },
    { key: 'status', labelKey: 'common.status', render: (r) => <StatusTag status={r.status} /> },
    {
      key: 'actions',
      label: '',
      render: (r) => (
        r.kind === 'TO' ? (
          <button
            className="btn btn-sm"
            disabled
            title={t('pickingBatches.transferBatchTooltip')}
          >
            {t('common.delete')}
          </button>
        ) : (
          <button
            className="btn btn-sm btn-danger"
            onClick={(e) => { e.stopPropagation(); openDelete(r); }}
            title={t('pickingBatches.releaseTooltip')}
          >
            {t('common.delete')}
          </button>
        )
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('nav.pickingBatches')}>
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          {t(loading ? 'pickingTicketPrint.refreshing' : 'common.refresh')}
        </button>
      </PageHeader>

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
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Active pick batches hold the lock that keeps an order out of any
          other pick round. Releasing a batch unwinds it -- allocations are
          freed and picked units are returned to their source bins in the
          WMS -- and the orders become pickable again. You are responsible
          for physically returning anything a picker already pulled.
        </p>
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          emptyMessageKey="pickingBatches.empty"
        />
      </div>

      {deleteTarget && (
        <Modal
          title={t('pickingBatches.releaseTitle', { batch: deleteTarget.batch_number })}
          onClose={closeDelete}
          footer={
            <>
              <button className="btn" onClick={closeDelete} disabled={deleteSubmitting}>
                {t('pickingBatches.keepBatch')}
              </button>
              <button
                className="btn btn-danger"
                onClick={submitDelete}
                disabled={deleteSubmitting}
              >
                {t(deleteSubmitting ? 'pickingBatches.releasing' : 'pickingBatches.releaseBatch')}
              </button>
            </>
          }
        >
          {deleteError && (
            <div className="form-error" style={{ marginBottom: 12 }}>{deleteError}</div>
          )}
          <p style={{ fontSize: 13, marginBottom: 12 }}>
            <RichText
              text={t('pickingBatches.releaseExplain')}
              values={{ batch: <strong>{deleteTarget.batch_number}</strong> }}
            />
          </p>
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            <OrdersCell batch={deleteTarget} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('pickingBatches.physicalReturnNote')}
          </p>
        </Modal>
      )}
    </div>
  );
}
