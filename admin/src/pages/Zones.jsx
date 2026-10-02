import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import { useLocale } from '../i18n/locale.jsx';

const ZONE_TYPES = ['RECEIVING', 'STORAGE', 'PICKING', 'STAGING', 'SHIPPING'];

export default function Zones() {
  const { t } = useLocale();
  const { warehouseId } = useWarehouse();
  const [zones, setZones] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => { if (warehouseId) loadZones(); }, [warehouseId]);

  async function loadZones() {
    const res = await api.get(`/admin/zones?warehouse_id=${warehouseId}`);
    if (res?.ok) {
      const data = await res.json();
      setZones(data.zones || []);
    }
  }

  function openCreate() {
    setEditId(null);
    setForm({ is_active: true });
    setError('');
    setShowModal(true);
  }

  function openEdit(zone) {
    setEditId(zone.zone_id);
    setForm(zone);
    setError('');
    setShowModal(true);
  }

  async function save() {
    setError('');
    const body = { zone_code: form.zone_code, zone_name: form.zone_name, zone_type: form.zone_type };
    const res = editId
      ? await api.put(`/admin/zones/${editId}`, { ...body, is_active: !!form.is_active })
      : await api.post('/admin/zones', { ...body, warehouse_id: warehouseId });
    if (res?.ok) {
      setShowModal(false);
      loadZones();
    } else {
      const data = await res?.json();
      setError(data?.error || 'Failed to save');
    }
  }

  async function deleteZone() {
    setError('');
    const target = deleteTarget;
    if (!target) return;
    const res = await api.delete(`/admin/zones/${target.zone_id}`);
    if (res?.ok) {
      setDeleteTarget(null);
      loadZones();
    } else {
      const data = await res?.json();
      setError(data?.error || 'Failed to delete zone');
      setDeleteTarget(null);
    }
  }

  const columns = [
    { key: 'zone_code', labelKey: 'zones.code', mono: true },
    { key: 'zone_name', labelKey: 'zones.name' },
    { key: 'zone_type', labelKey: 'common.type' },
    {
      key: 'is_active',
      labelKey: 'items.active',
      render: (r) => t(r.is_active ? 'common.yes' : 'common.no'),
    },
    { key: 'actions', label: '', render: (r) => (
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(r); }} aria-label={t('common.edit')} title={t('common.edit')}>&#9998;</button>
        <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }} aria-label={t('common.delete')} title={t('common.delete')}>&#128465;</button>
      </div>
    )},
  ];

  return (
    <div>
      <PageHeader title={t('nav.zones')}>
        <button className="btn btn-primary" onClick={openCreate}>{t('zones.newZone')}</button>
      </PageHeader>
      <DataTable rowKey="zone_id" columns={columns} data={zones} emptyMessageKey="zones.empty" />

      {showModal && (
        <Modal
          title={t(editId ? 'zones.editZone' : 'zones.newZone')}
          onClose={() => { setShowModal(false); setError(''); }}
          footer={
            <>
              <button className="btn" onClick={() => { setShowModal(false); setError(''); }}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
            </>
          }
        >
          {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="form-group">
            <label>{t('zones.code')}</label>
            <input className="form-input" value={form.zone_code || ''} onChange={(e) => setForm({ ...form, zone_code: e.target.value })} />
          </div>
          <div className="form-group">
            <label>{t('zones.name')}</label>
            <input className="form-input" value={form.zone_name || ''} onChange={(e) => setForm({ ...form, zone_name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>{t('common.type')}</label>
            <select className="form-select" value={form.zone_type || ''} onChange={(e) => setForm({ ...form, zone_type: e.target.value })}>
              <option value="">{t('bins.selectType')}</option>
              {ZONE_TYPES.map((zt) => <option key={zt} value={zt}>{t(`zones.type.${zt}`)}</option>)}
            </select>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title={t('zones.deleteTitle', { code: deleteTarget.zone_code || '' })}
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button>
              <button className="btn btn-danger" onClick={deleteZone}>{t('common.delete')}</button>
            </>
          }
        >
          <p style={{ fontSize: 13 }}>
            {t('zones.deleteExplain')}
          </p>
          {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
        </Modal>
      )}
    </div>
  );
}
