import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import SkuBarcodeAutocomplete from '../components/SkuBarcodeAutocomplete.jsx';
import { useLocale } from '../i18n/locale.jsx';

export default function PreferredBins() {
  const { t } = useLocale();
  const { warehouseId } = useWarehouse();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ item_id: '', bin_id: '', priority: '1' });
  const [itemSearch, setItemSearch] = useState('');
  const [bins, setBins] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editPriority, setEditPriority] = useState('');
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => { load(); }, [search]);

  async function load() {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    const res = await api.get(`/admin/preferred-bins?${params}`);
    if (res?.ok) {
      const data = await res.json();
      setRows(data.preferred_bins || []);
    }
  }

  async function openAdd() {
    const binRes = await api.get(`/admin/bins?warehouse_id=${warehouseId}`);
    if (binRes?.ok) setBins((await binRes.json()).bins || []);
    setAddForm({ item_id: '', bin_id: '', priority: '1' });
    setItemSearch('');
    setShowAdd(true);
  }

  async function saveAdd() {
    if (!addForm.item_id || !addForm.bin_id) return;
    const res = await api.post('/admin/preferred-bins', {
      item_id: Number(addForm.item_id),
      bin_id: Number(addForm.bin_id),
      priority: Number(addForm.priority) || 1,
    });
    if (res?.ok) {
      setShowAdd(false);
      setMessageIsError(false);
      setMessage(t('preferredBins.added'));
      load();
    } else {
      const data = await res?.json();
      // A Staging / PickableStaging bin is rejected here. Show it
      // as an error, not a green success banner.
      setMessageIsError(true);
      setMessage(data?.error || 'Failed to add');
    }
  }

  async function savePriority(pbId) {
    const val = Number(editPriority);
    if (!val || val < 1) return;
    const res = await api.put(`/admin/preferred-bins/${pbId}`, { priority: val });
    if (res?.ok) {
      setEditingId(null);
      load();
    } else {
      // Surface the failure instead of silently leaving the old value.
      const data = await res?.json();
      setMessageIsError(true);
      setMessage(data?.error || 'Failed to update priority');
    }
  }

  async function deletePB(pbId) {
    if (!confirm(t('preferredBins.deleteConfirm'))) return;
    const res = await api.delete(`/admin/preferred-bins/${pbId}`);
    if (res?.ok) load();
  }

  function sanitize(val) {
    if (typeof val !== 'string') return val ?? '';
    const escaped = `"${val.replace(/"/g, '""')}"`;
    if (/^[=+\-@\t\r]/.test(val)) return `"'${val.replace(/"/g, '""')}"`;
    return escaped;
  }

  function exportCSV() {
    const header = 'SKU,Item Name,Bin Code,Zone,Priority,Last Updated';
    const csvRows = rows.map((r) =>
      `${sanitize(r.sku)},${sanitize(r.item_name)},${sanitize(r.bin_code)},${sanitize(r.zone_name || '')},${r.priority},${sanitize(r.updated_at || '')}`
    );
    const blob = new Blob([header + '\n' + csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${new Date().toISOString().slice(0, 10)}PreferredBins.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const columns = [
    { key: 'sku', labelKey: 'common.sku', mono: true },
    { key: 'item_name', labelKey: 'common.itemName' },
    { key: 'bin_code', labelKey: 'preferredBins.bin', mono: true },
    { key: 'zone_name', labelKey: 'common.zone', render: (r) => r.zone_name || '-' },
    { key: 'priority', labelKey: 'items.priority', render: (r) => {
      if (editingId === r.preferred_bin_id) {
        return (
          <span style={{ display: 'flex', gap: 4 }}>
            <input
              className="form-input"
              type="number"
              min="1"
              value={editPriority}
              onChange={(e) => setEditPriority(e.target.value)}
              style={{ width: 50, padding: '2px 6px', fontSize: 13 }}
              onKeyDown={(e) => e.key === 'Enter' && savePriority(r.preferred_bin_id)}
            />
            <button className="btn btn-sm" onClick={() => savePriority(r.preferred_bin_id)}>{t('common.ok')}</button>
          </span>
        );
      }
      return (
        <span
          style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
          onClick={() => { setEditingId(r.preferred_bin_id); setEditPriority(String(r.priority)); }}
        >
          {r.priority}
        </span>
      );
    }},
    { key: 'updated_at', labelKey: 'preferredBins.updated', mono: true, render: (r) => r.updated_at ? new Date(r.updated_at).toLocaleDateString() : '-' },
    { key: 'actions', label: '', render: (r) => (
      <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); deletePB(r.preferred_bin_id); }}>{t('common.delete')}</button>
    )},
  ];

  return (
    <div>
      <PageHeader title={t('nav.preferredBins')}>
        <button className="btn" onClick={exportCSV}>{t('common.exportCsv')}</button>
        <button className="btn btn-primary" onClick={openAdd}>{t('preferredBins.add')}</button>
      </PageHeader>

      {message && (
        <div style={{ marginBottom: 12, fontSize: 13, color: messageIsError ? 'var(--danger)' : 'var(--success)' }}>{message}</div>
      )}

      <div className="filter-bar">
        <input
          className="form-input"
          placeholder={t('preferredBins.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <DataTable rowKey="preferred_bin_id" columns={columns} data={rows} emptyMessageKey="preferredBins.empty" />

      {showAdd && (
        <Modal
          title={t('preferredBins.add')}
          onClose={() => setShowAdd(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowAdd(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={saveAdd} disabled={!addForm.item_id || !addForm.bin_id}>{t('common.save')}</button>
            </>
          }
        >
          <div className="form-group">
            <label>{t('common.item')}</label>
            <SkuBarcodeAutocomplete
              listId="preferred-bins-item-options"
              minChars={2}
              placeholder={t('skuSearch.placeholder')}
              value={itemSearch}
              onChange={(v) => {
                setItemSearch(v);
                setAddForm((f) => ({ ...f, item_id: '' }));
              }}
              onItemSelect={(it) => {
                if (it) {
                  setAddForm((f) => ({ ...f, item_id: it.item_id }));
                  setItemSearch(it.sku || '');
                }
              }}
              apiOptions={{ silentPermissionDenied: true }}
            />
          </div>
          <div className="form-group">
            <label>{t('common.bin')}</label>
            <select className="form-select" value={addForm.bin_id} onChange={(e) => setAddForm({ ...addForm, bin_id: e.target.value })}>
              <option value="">{t('settings.selectBin')}</option>
              {bins.map((b) => (
                <option key={b.bin_id} value={b.bin_id}>{b.bin_code} - {b.zone_name || ''}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>{t('items.priority')}</label>
            <input className="form-input" type="number" min="1" value={addForm.priority} onChange={(e) => setAddForm({ ...addForm, priority: e.target.value })} style={{ width: 80 }} />
          </div>
        </Modal>
      )}
    </div>
  );
}
