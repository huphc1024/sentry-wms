import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import SkuBarcodeAutocomplete from '../components/SkuBarcodeAutocomplete.jsx';
import { useLocale } from '../i18n/locale.jsx';

// Bin + item lookups switched from preloaded
// dropdowns to debounced server-side search so 30K SKUs and 3K bins
// stop hiding past the per_page cutoff. Same pattern as Adjustments.
// The two bin pickers (source + dest) operate independently
// so a transfer between two large warehouses no longer blocks on a
// 50-row default.

const dropdownStyle = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  maxHeight: 200,
  overflowY: 'auto',
  background: 'var(--panel)',
  border: '1px solid #ddd',
  borderRadius: 8,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  zIndex: 100,
};

const dropdownItemStyle = {
  padding: '8px 12px',
  cursor: 'pointer',
  borderBottom: '1px solid #f0f0f0',
  fontSize: 13,
};

function useDebouncedBinSearch(warehouseId, query, selectedId) {
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = (query || '').trim();
    if (!warehouseId || q.length < 1 || selectedId) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      const res = await api.get(
        `/admin/bins?warehouse_id=${warehouseId}&q=${encodeURIComponent(q)}&per_page=25`,
      );
      setSearching(false);
      if (!res?.ok) return;
      const data = await res.json();
      setResults(data.bins || []);
    }, 200);
    return () => clearTimeout(handle);
  }, [warehouseId, query, selectedId]);
  return { results, searching };
}

export default function InterWarehouseTransfers() {
  const { t } = useLocale();
  const [warehouses, setWarehouses] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({
    source_warehouse_id: '',
    source_bin_id: '',
    destination_warehouse_id: '',
    destination_bin_id: '',
    item_id: '',
    quantity: '',
  });

  // Typeahead state per lookup field.
  const [sourceBinSearch, setSourceBinSearch] = useState('');
  const [sourceBinOpen, setSourceBinOpen] = useState(false);
  const [destBinSearch, setDestBinSearch] = useState('');
  const [destBinOpen, setDestBinOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [itemSearching, setItemSearching] = useState(false);
  const sourceBinRef = useRef(null);
  const destBinRef = useRef(null);

  const sourceBinQuery = useDebouncedBinSearch(
    form.source_warehouse_id, sourceBinSearch, form.source_bin_id,
  );
  const destBinQuery = useDebouncedBinSearch(
    form.destination_warehouse_id, destBinSearch, form.destination_bin_id,
  );

  // Item search is warehouse-agnostic at the catalog level - the
  // transfer endpoint validates that the chosen item actually has
  // inventory in the source bin, so an unrelated catalog match just
  // bounces back with a clear error.

  useEffect(() => {
    function handleClick(e) {
      if (sourceBinRef.current && !sourceBinRef.current.contains(e.target)) setSourceBinOpen(false);
      if (destBinRef.current && !destBinRef.current.contains(e.target)) setDestBinOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    loadWarehouses();
    loadTransfers();
  }, []);

  // Reset source bin selection when source warehouse changes so a
  // stale (warehouse A, bin from B) state cannot reach the submit.
  useEffect(() => {
    setForm((f) => ({ ...f, source_bin_id: '' }));
    setSourceBinSearch('');
  }, [form.source_warehouse_id]);

  useEffect(() => {
    setForm((f) => ({ ...f, destination_bin_id: '' }));
    setDestBinSearch('');
  }, [form.destination_warehouse_id]);

  async function loadWarehouses() {
    const res = await api.get('/admin/warehouses', { silentPermissionDenied: true });
    if (res?.ok) {
      const data = await res.json();
      setWarehouses(data.warehouses || []);
    }
  }

  async function loadTransfers() {
    const res = await api.get('/admin/inter-warehouse-transfers?limit=50');
    if (res?.ok) {
      const data = await res.json();
      setTransfers(data.transfers || []);
    }
  }

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function selectSourceBin(b) {
    setForm((f) => ({ ...f, source_bin_id: b.bin_id }));
    setSourceBinSearch(b.bin_code);
    setSourceBinOpen(false);
  }

  function selectDestBin(b) {
    setForm((f) => ({ ...f, destination_bin_id: b.bin_id }));
    setDestBinSearch(b.bin_code);
    setDestBinOpen(false);
  }

  function selectItem(i) {
    setForm((f) => ({ ...f, item_id: i.item_id }));
    setItemSearch(i.sku || '');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!form.source_warehouse_id || !form.source_bin_id || !form.destination_warehouse_id || !form.destination_bin_id || !form.item_id || !form.quantity) {
      setError(t('interTransfers.allRequired'));
      return;
    }

    if (Number(form.quantity) < 1) {
      setError(t('interTransfers.minQty'));
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        from_warehouse_id: Number(form.source_warehouse_id),
        from_bin_id: Number(form.source_bin_id),
        to_warehouse_id: Number(form.destination_warehouse_id),
        to_bin_id: Number(form.destination_bin_id),
        item_id: Number(form.item_id),
        quantity: Number(form.quantity),
      };
      const res = await api.post('/admin/inter-warehouse-transfer', body);
      if (res?.ok) {
        const data = await res.json();
        setSuccess(data.message || 'Transfer created successfully.');
        setForm({ source_warehouse_id: '', source_bin_id: '', destination_warehouse_id: '', destination_bin_id: '', item_id: '', quantity: '' });
        setSourceBinSearch('');
        setDestBinSearch('');
        setItemSearch('');
        loadTransfers();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || t('interTransfers.failed', { status: res.status }));
      }
    } catch (err) {
      setError(t('common.networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  }

  function statusTag(status) {
    const cls = status === 'completed' ? 'tag tag-success' : 'tag tag-info';
    // `completed` is the API's own value; the label moves, the value
    // does not.
    return <span className={cls}>{t(`status.${String(status).toUpperCase()}`)}</span>;
  }

  return (
    <div>
      <PageHeader title={t('nav.transfers')} />

      <div className="settings-section">
        <h3>{t('interTransfers.create')}</h3>
        {error && <div className="form-error" style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}
        {success && <div className="form-success" style={{ color: 'var(--success)', marginBottom: 12 }}>{success}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>{t('transferOrders.sourceWarehouse')}</label>
              <select className="form-select" value={form.source_warehouse_id} onChange={(e) => updateField('source_warehouse_id', e.target.value)}>
                <option value="">{t('rma.selectWarehouse')}</option>
                {warehouses.map((w) => (
                  <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_name} ({w.warehouse_code})</option>
                ))}
              </select>
            </div>
            <div className="form-group" ref={sourceBinRef} style={{ position: 'relative' }}>
              <label>
                {t('interTransfers.sourceBin')}{' '}
                {sourceBinQuery.searching && (
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {t('interTransfers.searching')}
                  </span>
                )}
              </label>
              <input
                className="form-input mono"
                placeholder={t(form.source_warehouse_id
                  ? 'interTransfers.typeBinCode'
                  : 'interTransfers.pickWarehouseFirst')}
                value={sourceBinSearch}
                onChange={(e) => { setSourceBinSearch(e.target.value); updateField('source_bin_id', ''); setSourceBinOpen(true); }}
                onFocus={() => setSourceBinOpen(true)}
                disabled={!form.source_warehouse_id}
                autoComplete="off"
              />
              {sourceBinOpen && sourceBinQuery.results.length > 0 && (
                <div style={dropdownStyle}>
                  {sourceBinQuery.results.map((b) => (
                    <div key={b.bin_id} style={dropdownItemStyle} onMouseDown={() => selectSourceBin(b)}>
                      <span className="mono">{b.bin_code}</span> {b.bin_type ? `(${b.bin_type})` : ''}
                    </div>
                  ))}
                </div>
              )}
              {sourceBinOpen && !sourceBinQuery.searching && sourceBinSearch.trim().length >= 1 && !form.source_bin_id && sourceBinQuery.results.length === 0 && (
                <div style={{ ...dropdownStyle, padding: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
                  {t('interTransfers.noBinsMatch', { query: sourceBinSearch.trim() })}
                </div>
              )}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t('transferOrders.destWarehouse')}</label>
              <select className="form-select" value={form.destination_warehouse_id} onChange={(e) => updateField('destination_warehouse_id', e.target.value)}>
                <option value="">{t('rma.selectWarehouse')}</option>
                {warehouses.map((w) => (
                  <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_name} ({w.warehouse_code})</option>
                ))}
              </select>
            </div>
            <div className="form-group" ref={destBinRef} style={{ position: 'relative' }}>
              <label>
                {t('interTransfers.destBin')}{' '}
                {destBinQuery.searching && (
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {t('interTransfers.searching')}
                  </span>
                )}
              </label>
              <input
                className="form-input mono"
                placeholder={t(form.destination_warehouse_id ? 'interTransfers.typeBinCode' : 'interTransfers.pickWarehouseFirst')}
                value={destBinSearch}
                onChange={(e) => { setDestBinSearch(e.target.value); updateField('destination_bin_id', ''); setDestBinOpen(true); }}
                onFocus={() => setDestBinOpen(true)}
                disabled={!form.destination_warehouse_id}
                autoComplete="off"
              />
              {destBinOpen && destBinQuery.results.length > 0 && (
                <div style={dropdownStyle}>
                  {destBinQuery.results.map((b) => (
                    <div key={b.bin_id} style={dropdownItemStyle} onMouseDown={() => selectDestBin(b)}>
                      <span className="mono">{b.bin_code}</span> {b.bin_type ? `(${b.bin_type})` : ''}
                    </div>
                  ))}
                </div>
              )}
              {destBinOpen && !destBinQuery.searching && destBinSearch.trim().length >= 1 && !form.destination_bin_id && destBinQuery.results.length === 0 && (
                <div style={{ ...dropdownStyle, padding: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
                  {t('interTransfers.noBinsMatch', { query: destBinSearch.trim() })}
                </div>
              )}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>
                {t('common.item')}{' '}
                {itemSearching && (
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {t('interTransfers.searching')}
                  </span>
                )}
              </label>
              <SkuBarcodeAutocomplete
                listId="iwt-item-options"
                minChars={2}
                perPage={25}
                placeholder={t('skuSearch.placeholderMin2')}
                value={itemSearch}
                onChange={(v) => { setItemSearch(v); updateField('item_id', ''); }}
                onItemSelect={(it) => { if (it) selectItem(it); }}
                onSearchingChange={setItemSearching}
                showNoMatch={itemSearch.trim().length >= 2 && !form.item_id}
              />
            </div>
            <div className="form-group">
              <label>{t('salesOrders.quantity')}</label>
              <input className="form-input" type="number" min="1" value={form.quantity} onChange={(e) => updateField('quantity', e.target.value)} placeholder={t('common.qty')} />
            </div>
          </div>

          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {t(submitting ? 'interTransfers.submitting' : 'interTransfers.create')}
          </button>
        </form>
      </div>

      <div className="settings-section" style={{ marginTop: 24 }}>
        <h3>{t('interTransfers.recent')}</h3>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('notifications.id')}</th>
                <th>{t('common.item')}</th>
                <th>{t('common.qty')}</th>
                <th>{t('webhooks.from')}</th>
                <th>{t('webhooks.to')}</th>
                <th>{t('common.status')}</th>
                <th>{t('salesOrders.created')}</th>
              </tr>
            </thead>
            <tbody>
              {transfers.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>{t('interTransfers.empty')}</td></tr>
              )}
              {transfers.map((row) => (
                <tr key={row.transfer_id || row.id}>
                  <td>{row.transfer_id || row.id}</td>
                  <td>{row.sku || row.item_name || row.item_id}</td>
                  <td>{row.quantity}</td>
                  <td>{row.from_warehouse_name || row.from_warehouse_code || row.from_warehouse_id} / {row.from_bin_code || row.from_bin_id}</td>
                  <td>{row.to_warehouse_name || row.to_warehouse_code || row.to_warehouse_id} / {row.to_bin_code || row.to_bin_id}</td>
                  <td>{statusTag(row.status || 'completed')}</td>
                  <td style={{ fontFamily: 'monospace' }}>{formatDate(row.transferred_at || row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
