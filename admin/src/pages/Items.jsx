import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import { useLocale } from '../i18n/locale.jsx';

const FILTER_OPTIONS = [
  { labelKey: 'items.filterActive', value: 'active' },
  { labelKey: 'items.filterArchived', value: 'archived' },
  { labelKey: 'common.all', value: 'all' },
];

const STORAGE_PROFILES = [
  { value: 'HEAVY', labelKey: 'items.profileHeavy' },
  { value: 'FMCG', labelKey: 'items.profileFmcg' },
  { value: 'FULFILLMENT', labelKey: 'items.profileFulfillment' },
  { value: 'PROJECT', labelKey: 'items.profileProject' },
];
const KG_TO_LB = 2.2046226218;
const CM_TO_IN = 0.3937007874;

function numberOrNull(value) {
  return value === '' || value == null ? null : Number(value);
}

function itemToForm(item) {
  return {
    ...item,
    weight_kg: item.weight_lbs != null ? (Number(item.weight_lbs) / KG_TO_LB).toFixed(3) : '',
    length_cm: item.length_in != null ? (Number(item.length_in) / CM_TO_IN).toFixed(1) : '',
    width_cm: item.width_in != null ? (Number(item.width_in) / CM_TO_IN).toFixed(1) : '',
    height_cm: item.height_in != null ? (Number(item.height_in) / CM_TO_IN).toFixed(1) : '',
    barcode_aliases_text: (item.barcode_aliases || []).join('\n'),
  };
}

export default function Items() {
  const { t } = useLocale();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [filter, setFilter] = useState('active');
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');

  // Debounce typed search and guard against out-of-order responses.
  // Each run owns an AbortController; the cleanup cancels a pending
  // debounce timer (rapid typing) AND aborts an in-flight request (a
  // superseded query), so only the latest query's response reaches
  // setItems. Without this, slow broad-prefix queries (e.g. "1" matches
  // 23k items) resolve late and overwrite the narrow result, leaving
  // stale "floater" rows from earlier keystrokes. Page/filter changes
  // are discrete clicks, so they fire immediately (no debounce delay).
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => loadItems(controller.signal), search ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [page, search, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  // signal is supplied by the debounced effect so a superseded query
  // aborts mid-flight. The mutation handlers (save/delete/archive) call
  // loadItems() with no signal and refetch unconditionally.
  async function loadItems(signal) {
    const params = new URLSearchParams({ page, per_page: 50 });
    if (search) params.set('q', search);
    if (filter === 'active') params.set('active', 'true');
    else if (filter === 'archived') params.set('active', 'false');
    let res;
    try {
      res = await api.get(`/admin/items?${params}`, { signal });
    } catch (err) {
      if (err?.name === 'AbortError') return; // superseded by a newer query
      throw err;
    }
    if (res?.ok) {
      const data = await res.json();
      const mapped = (data.items || []).map((item) => ({
        ...item,
        id: item.id || item.item_id,
      }));
      setItems(mapped);
      setPagination({ page: data.page, pages: data.pages, total: data.total, per_page: data.per_page });
    }
  }

  async function viewItem(item) {
    const res = await api.get(`/admin/items/${item.id}`);
    if (res?.ok) {
      const data = await res.json();
      const itemData = data.item || data;
      setDetail({
        ...itemData,
        id: itemData.id || itemData.item_id,
        inventory: data.inventory || itemData.inventory || [],
        preferred_bins: data.preferred_bins || itemData.preferred_bins || [],
      });
    }
  }

  function openCreate() {
    setEditId(null);
    setForm({
      is_active: true,
      is_lot_tracked: false,
      is_serial_tracked: false,
      reorder_point: 0,
      reorder_qty: 0,
    });
    setError('');
    setShowModal(true);
  }

  async function openEdit(item) {
    const id = item.id || item.item_id;
    setEditId(id);
    const res = await api.get(`/admin/items/${id}`);
    const data = res?.ok ? await res.json() : null;
    const fullItem = data?.item || item;
    setForm(itemToForm({ ...fullItem, id }));
    setError('');
    setShowModal(true);
  }

  async function save() {
    setError('');
    const body = {
      sku: form.sku,
      item_name: form.item_name,
      description: form.description || null,
      upc: form.upc || null,
      mpn: form.mpn || null,
      barcode_aliases: (form.barcode_aliases_text || '')
        .split(/[\n,;]+/)
        .map((value) => value.trim())
        .filter(Boolean),
      category: form.category || null,
      storage_profile: form.storage_profile || null,
      weight_lbs: form.weight_kg === '' || form.weight_kg == null
        ? null
        : Number(form.weight_kg) * KG_TO_LB,
      length_in: form.length_cm === '' || form.length_cm == null
        ? null
        : Number(form.length_cm) * CM_TO_IN,
      width_in: form.width_cm === '' || form.width_cm == null
        ? null
        : Number(form.width_cm) * CM_TO_IN,
      height_in: form.height_cm === '' || form.height_cm == null
        ? null
        : Number(form.height_cm) * CM_TO_IN,
      default_bin_id: form.default_bin_id ? Number(form.default_bin_id) : null,
      reorder_point: numberOrNull(form.reorder_point) ?? 0,
      reorder_qty: numberOrNull(form.reorder_qty) ?? 0,
      is_lot_tracked: !!form.is_lot_tracked,
      is_serial_tracked: !!form.is_serial_tracked,
    };
    const res = editId
      ? await api.put(`/admin/items/${editId}`, body)
      : await api.post('/admin/items', body);
    if (res?.ok) {
      setShowModal(false);
      setDetail(null);
      loadItems();
    } else {
      const data = await res?.json();
      setError(data?.error || 'Failed to save');
    }
  }

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

  async function deleteItem(id) {
    setShowDeleteConfirm(id);
  }

  async function confirmDeleteItem() {
    const id = showDeleteConfirm;
    setShowDeleteConfirm(null);
    const res = await api.delete(`/admin/items/${id}`);
    if (res?.ok) {
      setDetail(null);
      setShowModal(false);
      loadItems();
    } else {
      const data = await res?.json();
      setError(data?.error || 'Failed to delete item');
    }
  }

  async function toggleArchive(item) {
    const res = await api.post(`/admin/items/${item.id}/archive`);
    if (res?.ok) {
      setDetail(null);
      loadItems();
    } else {
      const data = await res?.json();
      setError(data?.error || 'Failed to update item');
    }
  }

  const columns = [
    { key: 'sku', labelKey: 'common.sku', mono: true },
    { key: 'item_name', labelKey: 'common.itemName' },
    { key: 'upc', labelKey: 'common.upc', mono: true, render: (r) => r.upc || '-' },
    { key: 'mpn', labelKey: 'items.mpn', mono: true, render: (r) => r.mpn || '-' },
    { key: 'default_bin_code', labelKey: 'items.defaultBin', mono: true, render: (r) => r.default_bin_code || '\u2013' },
    { key: 'storage_profile', labelKey: 'items.zone3pl', render: (r) => r.storage_profile || '-' },
    { key: 'category', labelKey: 'items.category', render: (r) => r.category || '-' },
    { key: 'weight_lbs', labelKey: 'items.weight', render: (r) => r.weight_lbs != null ? `${(r.weight_lbs / KG_TO_LB).toFixed(2)} kg` : '-' },
    {
      key: 'is_active',
      labelKey: 'items.active',
      render: (r) => t(r.is_active ? 'common.yes' : 'common.no'),
    },
    { key: 'actions', label: '', render: (r) => (
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(r); }} aria-label={t('common.edit')} title={t('common.edit')}>&#9998;</button>
        <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); deleteItem(r.id || r.item_id); }} aria-label={t('common.delete')} title={t('common.delete')}>&#128465;</button>
      </div>
    )},
  ];

  const invCols = [
    { key: 'bin_code', labelKey: 'common.bin', mono: true },
    { key: 'quantity_on_hand', labelKey: 'common.onHand' },
    { key: 'quantity_allocated', labelKey: 'common.allocated' },
  ];

  return (
    <div>
      <PageHeader title={t('nav.items')}>
        <button className="btn btn-primary" onClick={openCreate}>{t('items.newItem')}</button>
      </PageHeader>
      <div className="filter-bar">
        <input className="form-input" placeholder={t('items.searchPlaceholder')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select
          className="form-select"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setPage(1); }}
          style={{ width: 'auto', minWidth: 120 }}
        >
          {FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
          ))}
        </select>
      </div>
      <DataTable rowKey="item_id" columns={columns} data={items} pagination={pagination} onPageChange={setPage} onRowClick={viewItem} />

      {detail && !showModal && (
        <Modal title={detail.item_name || detail.sku} onClose={() => setDetail(null)}
          footer={<button className="btn" onClick={() => setDetail(null)}>{t('common.close')}</button>}
        >
          <div className="detail-grid">
            <span className="detail-label">{t('common.sku')}</span><span className="mono">{detail.sku}</span>
            <span className="detail-label">{t('common.upc')}</span><span className="mono">{detail.upc || '-'}</span>
            <span className="detail-label">{t('items.mpn')}</span><span className="mono">{detail.mpn || '-'}</span>
            <span className="detail-label">{t('items.category')}</span><span>{detail.category || '-'}</span>
            <span className="detail-label">{t('items.zone3pl')}</span><span>{detail.storage_profile || '-'}</span>
            <span className="detail-label">{t('items.weight')}</span><span>{detail.weight_lbs != null ? `${(detail.weight_lbs / KG_TO_LB).toFixed(3)} kg` : '-'}</span>
            <span className="detail-label">{t('items.dimensions')}</span>
            <span>
              {[detail.length_in, detail.width_in, detail.height_in].every((v) => v != null)
                ? `${(detail.length_in / CM_TO_IN).toFixed(1)} × ${(detail.width_in / CM_TO_IN).toFixed(1)} × ${(detail.height_in / CM_TO_IN).toFixed(1)} cm`
                : '-'}
            </span>
            <span className="detail-label">{t('items.lotExpiry')}</span>
            <span>{t(detail.is_lot_tracked ? 'items.tracked' : 'items.notTracked')}</span>
            <span className="detail-label">{t('items.serial')}</span>
            <span>{t(detail.is_serial_tracked ? 'items.tracked' : 'items.notTracked')}</span>
            <span className="detail-label">{t('items.reorder')}</span>
            <span>
              {t('items.reorderValue', {
                point: detail.reorder_point ?? 0,
                qty: detail.reorder_qty ?? 0,
              })}
            </span>
            <span className="detail-label">{t('items.barcodeAliases')}</span><span className="mono">{(detail.barcode_aliases || []).join(', ') || '-'}</span>
            <span className="detail-label">{t('items.description')}</span><span>{detail.description || '-'}</span>
            <span className="detail-label">{t('items.active')}</span>
            <span>{t(detail.is_active ? 'common.yes' : 'common.no')}</span>
          </div>
          {detail.preferred_bins && detail.preferred_bins.length > 0 && (
            <>
              <div className="section-title">{t('nav.preferredBins')}</div>
              <DataTable rowKey="preferred_bin_id" columns={[
                { key: 'bin_code', labelKey: 'common.bin', mono: true },
                { key: 'zone_name', labelKey: 'common.zone' },
                { key: 'priority', labelKey: 'items.priority' },
              ]} data={detail.preferred_bins} />
            </>
          )}
          {detail.inventory && detail.inventory.length > 0 && (
            <>
              <div className="section-title">{t('items.inventoryLocations')}</div>
              <DataTable rowKey="inventory_id" columns={invCols} data={detail.inventory} />
            </>
          )}
        </Modal>
      )}

      {showModal && (
        <Modal title={t(editId ? 'items.editItem' : 'items.newItem')} onClose={() => setShowModal(false)}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {editId && (
                  <button className="btn btn-sm" onClick={() => toggleArchive(form)}>
                    {t(form.is_active ? 'items.archive' : 'items.restore')}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn" onClick={() => setShowModal(false)}>{t('common.cancel')}</button>
                <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
              </div>
            </div>
          }
        >
          {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="form-row">
            <div className="form-group">
              <label>{t('common.sku')}</label>
              <input className="form-input" value={form.sku || ''} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('common.upc')}</label>
              <input className="form-input" value={form.upc || ''} onChange={(e) => setForm({ ...form, upc: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>{t('items.mpn')}</label>
            <input className="form-input" value={form.mpn || ''} onChange={(e) => setForm({ ...form, mpn: e.target.value })} />
          </div>
          <div className="form-group">
            <label>{t('common.itemName')}</label>
            <input className="form-input" value={form.item_name || ''} onChange={(e) => setForm({ ...form, item_name: e.target.value })} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('items.category')}</label>
              <input className="form-input" value={form.category || ''} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('items.storageProfile')}</label>
              <select className="form-select" value={form.storage_profile || ''} onChange={(e) => setForm({ ...form, storage_profile: e.target.value })}>
                <option value="">{t('items.unclassified')}</option>
                {STORAGE_PROFILES.map((profile) => (
                  <option key={profile.value} value={profile.value}>{t(profile.labelKey)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('items.weightKg')}</label>
              <input className="form-input" type="number" min="0" step="0.001" value={form.weight_kg ?? ''} onChange={(e) => setForm({ ...form, weight_kg: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('items.defaultBinId')}</label>
              <input className="form-input" type="number" min="1" value={form.default_bin_id ?? ''} onChange={(e) => setForm({ ...form, default_bin_id: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('items.lengthCm')}</label>
              <input className="form-input" type="number" min="0" step="0.1" value={form.length_cm ?? ''} onChange={(e) => setForm({ ...form, length_cm: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('items.widthCm')}</label>
              <input className="form-input" type="number" min="0" step="0.1" value={form.width_cm ?? ''} onChange={(e) => setForm({ ...form, width_cm: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('items.heightCm')}</label>
              <input className="form-input" type="number" min="0" step="0.1" value={form.height_cm ?? ''} onChange={(e) => setForm({ ...form, height_cm: e.target.value })} />
            </div>
          </div>
          {form.length_cm && form.width_cm && form.height_cm && (
            <div className="settings-note" style={{ marginTop: -4, marginBottom: 12 }}>
              {t('items.cbm', {
                value: (Number(form.length_cm) * Number(form.width_cm)
                  * Number(form.height_cm) / 1000000).toFixed(4),
              })}
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label>{t('items.reorderPoint')}</label>
              <input className="form-input" type="number" min="0" value={form.reorder_point ?? 0} onChange={(e) => setForm({ ...form, reorder_point: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('items.reorderQty')}</label>
              <input className="form-input" type="number" min="0" value={form.reorder_qty ?? 0} onChange={(e) => setForm({ ...form, reorder_qty: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <label className="checkbox-label">
              <input type="checkbox" checked={!!form.is_lot_tracked} onChange={(e) => setForm({ ...form, is_lot_tracked: e.target.checked })} />
              {t('items.trackLot')}
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={!!form.is_serial_tracked} onChange={(e) => setForm({ ...form, is_serial_tracked: e.target.checked })} />
              {t('items.trackSerial')}
            </label>
          </div>
          <div className="form-group">
            <label>
              {t('items.altBarcodes')}{' '}
              <span className="settings-note">{t('items.onePerLine')}</span>
            </label>
            <textarea className="form-input" rows="3" value={form.barcode_aliases_text || ''} onChange={(e) => setForm({ ...form, barcode_aliases_text: e.target.value })} />
          </div>
          <div className="form-group">
            <label>{t('items.descriptionNotes')}</label>
            <textarea className="form-input" rows="3" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </Modal>
      )}

      {showDeleteConfirm && (
        <Modal title={t('items.deleteItem')} onClose={() => setShowDeleteConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setShowDeleteConfirm(null)}>{t('common.cancel')}</button>
              <button className="btn btn-danger" onClick={confirmDeleteItem}>{t('common.delete')}</button>
            </>
          }
        >
          <p style={{ fontSize: 14, marginBottom: 8 }}>{t('common.areYouSure')}</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('items.deleteWarning')}</p>
        </Modal>
      )}
    </div>
  );
}
