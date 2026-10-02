import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import StatusTag from '../components/StatusTag.jsx';
import { useLocale } from '../i18n/locale.jsx';

export default function CycleCounts() {
  const { t } = useLocale();
  const { warehouseId } = useWarehouse();
  const [counts, setCounts] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [bins, setBins] = useState([]);
  const [selectedBins, setSelectedBins] = useState([]);
  const [message, setMessage] = useState('');
  const [selectedCount, setSelectedCount] = useState(null);

  useEffect(() => {
    loadCounts();
  }, []);

  async function loadCounts() {
    const res = await api.get('/admin/cycle-counts');
    if (res?.ok) {
      const data = await res.json();
      setCounts(data.cycle_counts || []);
    }
  }

  async function openCreate() {
    const res = await api.get(`/admin/bins?warehouse_id=${warehouseId}`);
    if (res?.ok) {
      const data = await res.json();
      setBins(data.bins || []);
    }
    setSelectedBins([]);
    setShowCreate(true);
  }

  function toggleBin(id) {
    setSelectedBins((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]
    );
  }

  async function createCount() {
    if (selectedBins.length === 0) return;
    const res = await api.post('/inventory/cycle-count/create', {
      bin_ids: selectedBins,
      warehouse_id: warehouseId,
    });
    if (res?.ok) {
      setMessage(t('cycleCounts.created'));
      setShowCreate(false);
      loadCounts();
    } else {
      const data = await res?.json();
      setMessage(data?.error || 'Failed to create count');
    }
  }

  const columns = [
    { key: 'count_id', labelKey: 'notifications.id', mono: true, render: (r) => `#${r.count_id}` },
    { key: 'bin_code', labelKey: 'common.bin', mono: true },
    { key: 'status', labelKey: 'common.status', render: (r) => <StatusTag status={r.status} /> },
    { key: 'assigned_to', labelKey: 'cycleCounts.assignedTo' },
    { key: 'lines', labelKey: 'nav.items', render: (r) => r.lines?.length || 0 },
    { key: 'variance', labelKey: 'cycleCounts.variances', render: (r) => {
      const variances = (r.lines || []).filter((l) => l.variance && l.variance !== 0);
      return variances.length > 0
        ? <span style={{ color: 'var(--copper)', fontWeight: 600 }}>{variances.length}</span>
        : <span style={{ color: 'var(--text-secondary)' }}>0</span>;
    }},
    { key: 'created_at', labelKey: 'salesOrders.created', mono: true, render: (r) => r.created_at ? new Date(r.created_at).toLocaleString() : '-' },
    { key: 'actions', label: '', render: (r) => (
      <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setSelectedCount(r); }}>{t('inboundActivity.view')}</button>
    )},
  ];

  return (
    <div>
      <PageHeader title={t('nav.counts')}>
        <button className="btn btn-primary" onClick={openCreate}>{t('cycleCounts.newCount')}</button>
      </PageHeader>

      {message && (
        <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--success)' }}>{message}</div>
      )}

      <DataTable rowKey="count_id" columns={columns} data={counts} emptyMessageKey="cycleCounts.empty" />

      {/* Create modal */}
      {showCreate && (
        <Modal
          title={t('cycleCounts.createTitle')}
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowCreate(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={createCount} disabled={selectedBins.length === 0}>
                {t('cycleCounts.createWithBins', { n: selectedBins.length })}
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            {t('cycleCounts.selectBins')}
          </p>
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            {bins.map((bin) => (
              <label key={bin.bin_id} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectedBins.includes(bin.bin_id)}
                  onChange={() => toggleBin(bin.bin_id)}
                />
                <span className="mono">{bin.bin_code}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{bin.zone_name || ''}</span>
              </label>
            ))}
          </div>
        </Modal>
      )}

      {/* Detail modal */}
      {selectedCount && (
        <Modal
          title={t('cycleCounts.countTitle', {
            id: selectedCount.count_id,
            bin: selectedCount.bin_code,
          })}
          onClose={() => setSelectedCount(null)}
          footer={<button className="btn" onClick={() => setSelectedCount(null)}>{t('common.close')}</button>}
        >
          <div style={{ marginBottom: 12 }}>
            <div className="detail-grid">
              <span className="detail-label">{t('common.status')}</span><span><StatusTag status={selectedCount.status} /></span>
              <span className="detail-label">{t('cycleCounts.assignedTo')}</span><span>{selectedCount.assigned_to || '-'}</span>
              <span className="detail-label">{t('salesOrders.created')}</span><span className="mono">{selectedCount.created_at ? new Date(selectedCount.created_at).toLocaleString() : '-'}</span>
              {selectedCount.completed_at && (
                <><span className="detail-label">{t('webhooks.colCompleted')}</span><span className="mono">{new Date(selectedCount.completed_at).toLocaleString()}</span></>
              )}
            </div>
          </div>

          {selectedCount.lines?.length > 0 ? (
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{t('common.sku')}</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{t('common.item')}</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{t('cycleCounts.expected')}</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{t('cycleCounts.counted')}</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{t('purchaseOrders.variance')}</th>
                </tr>
              </thead>
              <tbody>
                {selectedCount.lines.map((l) => {
                  const hasVariance = l.variance && l.variance !== 0;
                  return (
                    <tr key={l.count_line_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="mono" style={{ padding: '6px 8px' }}>{l.sku}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{l.item_name}</td>
                      <td className="mono" style={{ padding: '6px 8px', textAlign: 'right' }}>{l.expected_quantity}</td>
                      <td className="mono" style={{ padding: '6px 8px', textAlign: 'right' }}>{l.counted_quantity ?? '-'}</td>
                      <td className="mono" style={{ padding: '6px 8px', textAlign: 'right', color: hasVariance ? 'var(--copper)' : 'var(--text-secondary)', fontWeight: hasVariance ? 600 : 400 }}>
                        {l.variance != null ? (l.variance > 0 ? `+${l.variance}` : l.variance) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('salesOrders.noLineItems')}</p>
          )}
        </Modal>
      )}
    </div>
  );
}
