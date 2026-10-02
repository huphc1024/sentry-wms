import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import { useLocale } from '../i18n/locale.jsx';
import RichText from '../i18n/RichText.jsx';

// The value is the stored bin_type; only the label is translated,
// using the same keys the simulation page shows for the same three.
const BIN_TYPES = [
  { value: 'Staging', labelKey: 'warehouseSimulation.binTypeStaging' },
  { value: 'PickableStaging', labelKey: 'warehouseSimulation.binTypePickableStaging' },
  { value: 'Pickable', labelKey: 'warehouseSimulation.binTypePickable' },
];
const KG_TO_LB = 2.2046226218;
const M3_TO_CUFT = 35.3146667;

function binToForm(bin) {
  return {
    ...bin,
    max_weight_kg: bin.max_weight_lbs != null
      ? (Number(bin.max_weight_lbs) / KG_TO_LB).toFixed(1)
      : '',
    max_volume_m3: bin.max_volume_cuft != null
      ? (Number(bin.max_volume_cuft) / M3_TO_CUFT).toFixed(3)
      : '',
  };
}

export default function Bins() {
  const { t } = useLocale();
  const { warehouseId } = useWarehouse();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [bins, setBins] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [zones, setZones] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { if (warehouseId) { loadBins(); loadZones(); } }, [warehouseId, search, page]);  // eslint-disable-line react-hooks/exhaustive-deps

  async function loadBins() {
    const params = new URLSearchParams({ warehouse_id: String(warehouseId), page, per_page: 50 });
    if (search) params.set('q', search);
    const res = await api.get(`/admin/bins?${params}`);
    if (res?.ok) {
      const data = await res.json();
      setBins(data.bins || []);
      setPagination({ page: data.page, pages: data.pages, total: data.total, per_page: data.per_page });
    }
  }

  // Walks all pages and downloads the full result set as CSV. The API's
  // admin/bins endpoint caps page_size at 50 regardless of `per_page`,
  // so we paginate server-side and concat client-side. CSV mirrors the
  // BinImportRow schema (bin_code, bin_barcode, zone, warehouse_id,
  // bin_type, aisle, pick_sequence, putaway_sequence, description) so
  // an exported file is round-trip-importable via /admin/import/bins.
  async function exportCsv() {
    setExporting(true);
    try {
      const all = [];
      let p = 1;
      // Hard stop at 200 pages (=10k bins) to avoid runaway
      while (p <= 200) {
        const params = new URLSearchParams({ warehouse_id: String(warehouseId), page: p, per_page: 50 });
        if (search) params.set('q', search);
        const res = await api.get(`/admin/bins?${params}`);
        if (!res?.ok) break;
        const data = await res.json();
        all.push(...(data.bins || []));
        if (p >= (data.pages || 1)) break;
        p += 1;
      }
      const headers = [
        'bin_code','bin_barcode','zone','warehouse_id','bin_type','aisle',
        'row_num','level_num','position_num','pick_sequence','putaway_sequence',
        'max_weight_lbs','max_volume_cuft','description',
      ];
      const csvEscape = (v) => {
        if (v == null) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [headers.join(',')];
      for (const b of all) {
        lines.push([
          csvEscape(b.bin_code),
          csvEscape(b.bin_barcode),
          csvEscape(b.zone_name || b.zone || ''),
          csvEscape(b.warehouse_id ?? warehouseId),
          csvEscape(b.bin_type),
          csvEscape(b.aisle ?? ''),
          csvEscape(b.row_num ?? ''),
          csvEscape(b.level_num ?? ''),
          csvEscape(b.position_num ?? ''),
          csvEscape(b.pick_sequence ?? ''),
          csvEscape(b.putaway_sequence ?? ''),
          csvEscape(b.max_weight_lbs ?? ''),
          csvEscape(b.max_volume_cuft ?? ''),
          csvEscape(b.description ?? ''),
        ].join(','));
      }
      const csv = lines.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const today = new Date().toISOString().split('T')[0];
      link.download = `bins_warehouse${warehouseId}_${today}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function loadZones() {
    const res = await api.get(`/admin/zones?warehouse_id=${warehouseId}`);
    if (res?.ok) {
      const data = await res.json();
      setZones(data.zones || []);
    }
  }

  async function viewBin(bin) {
    setSelected(bin);
    setEditing(false);
    const res = await api.get(`/admin/bins/${bin.bin_id}`);
    if (res?.ok) {
      const data = await res.json();
      const flat = { ...(data.bin || {}), inventory: data.inventory || [] };
      setDetail(flat);
      setForm(binToForm(flat));
    }
  }

  function openEditFromRow(r) {
    setSelected(r);
    setForm(binToForm(r));
    setEditing(true);
    setError('');
  }

  async function deleteBin() {
    setError('');
    const target = deleteTarget;
    if (!target) return;
    const res = await api.delete(`/admin/bins/${target.bin_id}`);
    if (res?.ok) {
      setDeleteTarget(null);
      loadBins();
    } else {
      const data = await res?.json();
      setError(data?.error || 'Failed to delete');
      setDeleteTarget(null);
    }
  }

  async function saveBin() {
    setError('');
    const body = {
      bin_code: form.bin_code,
      bin_barcode: form.bin_barcode,
      bin_type: form.bin_type,
      zone_id: form.zone_id ? Number(form.zone_id) : null,
      aisle: form.aisle || null,
      row_num: form.row_num !== '' && form.row_num != null ? Number(form.row_num) : null,
      level_num: form.level_num !== '' && form.level_num != null ? Number(form.level_num) : null,
      position_num: form.position_num !== '' && form.position_num != null ? Number(form.position_num) : null,
      pick_sequence: form.pick_sequence !== '' && form.pick_sequence != null ? Number(form.pick_sequence) : 0,
      putaway_sequence: form.putaway_sequence !== '' && form.putaway_sequence != null ? Number(form.putaway_sequence) : 0,
      max_weight_lbs: form.max_weight_kg !== '' && form.max_weight_kg != null
        ? Number(form.max_weight_kg) * KG_TO_LB
        : null,
      max_volume_cuft: form.max_volume_m3 !== '' && form.max_volume_m3 != null
        ? Number(form.max_volume_m3) * M3_TO_CUFT
        : null,
      description: form.description || null,
    };
    const res = editing
      ? await api.put(`/admin/bins/${selected.bin_id}`, { ...body, is_active: !!form.is_active })
      : await api.post('/admin/bins', { ...body, warehouse_id: warehouseId });
    if (res?.ok) {
      setSelected(null); setDetail(null); setShowCreate(false); setEditing(false);
      loadBins();
    } else {
      const data = await res?.json();
      setError(data?.error || 'Failed to save');
    }
  }

  const columns = [
    { key: 'bin_code', labelKey: 'common.binCode', mono: true },
    { key: 'bin_barcode', labelKey: 'bins.barcode', mono: true },
    {
      key: 'bin_type',
      labelKey: 'common.type',
      // Same keys the form's dropdown uses, so the column and the
      // picker above it cannot disagree.
      render: (r) => {
        const match = BIN_TYPES.find((bt) => bt.value === r.bin_type);
        return match ? t(match.labelKey) : (r.bin_type || '-');
      },
    },
    { key: 'zone_name', labelKey: 'common.zone' },
    { key: 'aisle', labelKey: 'warehouseSimulation.aisle' },
    { key: 'row_num', labelKey: 'bins.bay' },
    { key: 'level_num', labelKey: 'warehouseSimulation.level' },
    { key: 'position_num', labelKey: 'bins.pos' },
    { key: 'max_weight_lbs', labelKey: 'bins.maxLoad', render: (r) => r.max_weight_lbs != null ? `${(r.max_weight_lbs / KG_TO_LB).toFixed(0)} kg` : '-' },
    { key: 'pick_sequence', labelKey: 'bins.pickSeq' },
    {
      key: 'is_active',
      labelKey: 'items.active',
      render: (r) => t(r.is_active ? 'common.yes' : 'common.no'),
    },
    { key: 'actions', label: '', render: (r) => (
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openEditFromRow(r); }} aria-label={t('common.edit')} title={t('common.edit')}>&#9998;</button>
        <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }} aria-label={t('common.delete')} title={t('common.delete')}>&#128465;</button>
      </div>
    )},
  ];

  const invCols = [
    { key: 'sku', labelKey: 'common.sku', mono: true },
    { key: 'item_name', labelKey: 'common.item' },
    { key: 'quantity_on_hand', labelKey: 'common.onHand' },
    { key: 'quantity_allocated', labelKey: 'common.allocated' },
  ];

  function renderForm() {
    return (
      <>
        {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
        <div className="form-row">
          <div className="form-group">
            <label>{t('common.binCode')}</label>
            <input className="form-input" value={form.bin_code || ''} onChange={(e) => setForm({ ...form, bin_code: e.target.value })} />
          </div>
          <div className="form-group">
            <label>{t('bins.barcode')}</label>
            <input className="form-input" value={form.bin_barcode || ''} onChange={(e) => setForm({ ...form, bin_barcode: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>{t('common.type')}</label>
            <select className="form-select" value={form.bin_type || ''} onChange={(e) => setForm({ ...form, bin_type: e.target.value })}>
              <option value="">{t('bins.selectType')}</option>
              {/* The parameter used to be named `t`, which now names
                  the translator. */}
              {BIN_TYPES.map((bt) => (
                <option key={bt.value} value={bt.value}>{t(bt.labelKey)}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>{t('common.zone')}</label>
            <select className="form-select" value={form.zone_id || ''} onChange={(e) => setForm({ ...form, zone_id: Number(e.target.value) })}>
              <option value="">{t('bins.selectZone')}</option>
              {zones.map((z) => <option key={z.zone_id} value={z.zone_id}>{z.zone_code} - {z.zone_name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>{t('warehouseSimulation.aisle')}</label>
            <input className="form-input" value={form.aisle || ''} onChange={(e) => setForm({ ...form, aisle: e.target.value })} />
          </div>
          <div className="form-group">
            <label>{t('bins.bay')}</label>
            <input className="form-input" type="number" min="0" value={form.row_num ?? ''} onChange={(e) => setForm({ ...form, row_num: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>{t('bins.levelRange')}</label>
            <input className="form-input" type="number" min="1" max="4" value={form.level_num ?? ''} onChange={(e) => setForm({ ...form, level_num: e.target.value })} />
          </div>
          <div className="form-group">
            <label>{t('bins.palletPosition')}</label>
            <input className="form-input" type="number" min="1" max="2" value={form.position_num ?? ''} onChange={(e) => setForm({ ...form, position_num: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>{t('bins.maxLoadKg')}</label>
            <input className="form-input" type="number" min="0" step="1" value={form.max_weight_kg ?? ''} onChange={(e) => setForm({ ...form, max_weight_kg: e.target.value })} />
          </div>
          <div className="form-group">
            <label>{t('bins.maxVolume')}</label>
            <input className="form-input" type="number" min="0" step="0.001" value={form.max_volume_m3 ?? ''} onChange={(e) => setForm({ ...form, max_volume_m3: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>{t('bins.pickSequence')}</label>
            <input className="form-input" type="number" min="0" value={form.pick_sequence ?? ''} onChange={(e) => setForm({ ...form, pick_sequence: e.target.value })} />
          </div>
          <div className="form-group">
            <label>{t('bins.putawaySequence')}</label>
            <input className="form-input" type="number" min="0" value={form.putaway_sequence ?? ''} onChange={(e) => setForm({ ...form, putaway_sequence: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label>{t('bins.descriptionNotes')}</label>
          <textarea className="form-input" rows="3" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </>
    );
  }

  return (
    <div>
      <PageHeader title={t('nav.bins')}>
        <input
          className="form-input"
          style={{ maxWidth: 320, marginRight: 8 }}
          placeholder={t('bins.searchPlaceholder')}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <button
          className="btn"
          onClick={exportCsv}
          disabled={exporting || !pagination?.total}
          style={{ marginRight: 8 }}
          title={t('bins.exportTooltip')}
        >
          {exporting ? t('bins.exporting') : t('common.exportCsv')}
        </button>
        <button className="btn btn-primary" onClick={() => { setForm({ is_active: true }); setShowCreate(true); setError(''); }}>{t('bins.newBin')}</button>
      </PageHeader>
      <DataTable rowKey="bin_id" columns={columns} data={bins} pagination={pagination} onPageChange={setPage} onRowClick={viewBin} />

      {selected && detail && !editing && (
        <Modal title={t('warehouseSimulation.binN', { code: detail.bin_code })} onClose={() => { setSelected(null); setDetail(null); setError(''); }}
          footer={
            <button className="btn" onClick={() => { setEditing(true); setForm(detail); setError(''); }}>{t('common.edit')}</button>
          }
        >
          <div className="detail-grid">
            <span className="detail-label">{t('bins.code')}</span><span className="mono">{detail.bin_code}</span>
            <span className="detail-label">{t('bins.barcode')}</span><span className="mono">{detail.bin_barcode}</span>
            <span className="detail-label">{t('common.type')}</span><span>{detail.bin_type}</span>
            <span className="detail-label">{t('common.zone')}</span><span>{detail.zone_name || '-'}</span>
            <span className="detail-label">{t('warehouseSimulation.aisle')}</span><span>{detail.aisle || '-'}</span>
            <span className="detail-label">{t('bins.bayLevelPosition')}</span>
            <span>{detail.row_num || '-'} / {detail.level_num || '-'} / {detail.position_num || '-'}</span>
            <span className="detail-label">{t('bins.maxLoad')}</span>
            <span>{detail.max_weight_lbs != null ? `${(detail.max_weight_lbs / KG_TO_LB).toFixed(1)} kg` : '-'}</span>
            <span className="detail-label">{t('bins.maxVolumeShort')}</span>
            <span>{detail.max_volume_cuft != null ? `${(detail.max_volume_cuft / M3_TO_CUFT).toFixed(3)} m³` : '-'}</span>
            <span className="detail-label">{t('bins.pickSeq')}</span><span>{detail.pick_sequence ?? '-'}</span>
            <span className="detail-label">{t('bins.putawaySeq')}</span><span>{detail.putaway_sequence ?? '-'}</span>
            <span className="detail-label">{t('common.notes')}</span><span>{detail.description || '-'}</span>
            <span className="detail-label">{t('items.active')}</span>
            <span>{t(detail.is_active ? 'common.yes' : 'common.no')}</span>
          </div>
          {detail.inventory && detail.inventory.length > 0 && (
            <>
              <div className="section-title">{t('nav.inventory')}</div>
              <DataTable rowKey="inventory_id" columns={invCols} data={detail.inventory} />
            </>
          )}
          {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title={t('bins.deleteTitle', { code: deleteTarget.bin_code })}
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button>
              <button className="btn btn-danger" onClick={deleteBin}>{t('common.delete')}</button>
            </>
          }
        >
          <p style={{ fontSize: 13 }}>
            <RichText
              text={t('bins.deleteExplain')}
              values={{ code: <span className="mono">{deleteTarget.bin_code}</span> }}
            />
          </p>
          {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
        </Modal>
      )}

      {(editing || showCreate) && (
        <Modal
          title={editing
            ? t('bins.editTitle', { code: form.bin_code })
            : t('bins.newBin')}
          onClose={() => { setEditing(false); setShowCreate(false); setSelected(null); setDetail(null); }}
          footer={
            <>
              <button className="btn" onClick={() => { setEditing(false); setShowCreate(false); setSelected(null); setDetail(null); }}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={saveBin}>{t('common.save')}</button>
            </>
          }
        >
          {renderForm()}
        </Modal>
      )}
    </div>
  );
}
