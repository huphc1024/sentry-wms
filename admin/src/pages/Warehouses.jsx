import { useState, useEffect } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import { useLocale } from '../i18n/locale.jsx';
import RichText from '../i18n/RichText.jsx';

export default function Warehouses() {
  const { t } = useLocale();
  const [warehouses, setWarehouses] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => { loadWarehouses(); }, []);

  async function loadWarehouses() {
    const res = await api.get('/admin/warehouses');
    if (res?.ok) {
      const data = await res.json();
      setWarehouses(data.warehouses || []);
    }
  }

  function openCreate() {
    setEditId(null);
    setForm({});
    setError('');
    setShowModal(true);
  }

  function openEdit(wh) {
    setEditId(wh.warehouse_id);
    setForm({ warehouse_code: wh.warehouse_code, warehouse_name: wh.warehouse_name, address: wh.address, is_active: wh.is_active });
    setError('');
    setShowModal(true);
  }

  async function save() {
    setError('');
    if (!form.warehouse_name) { setError(t('warehouses.nameRequired')); return; }
    if (!editId && !form.warehouse_code) { setError(t('warehouses.codeRequired')); return; }
    const res = editId
      ? await api.put(`/admin/warehouses/${editId}`, { warehouse_name: form.warehouse_name, address: form.address, is_active: form.is_active })
      : await api.post('/admin/warehouses', { warehouse_code: form.warehouse_code, warehouse_name: form.warehouse_name, address: form.address });
    if (res?.ok) {
      setShowModal(false);
      loadWarehouses();
    } else {
      const data = await res?.json();
      setError(data?.error || 'Failed to save');
    }
  }

  async function deleteWarehouse(id) {
    setError('');
    const res = await api.delete(`/admin/warehouses/${id}`);
    if (res?.ok) {
      setConfirmDelete(null);
      loadWarehouses();
    } else {
      const data = await res?.json();
      setConfirmDelete(null);
      setError(data?.error || 'Failed to delete warehouse');
    }
  }

  const columns = [
    { key: 'warehouse_code', labelKey: 'bins.code', mono: true },
    { key: 'warehouse_name', labelKey: 'common.name' },
    { key: 'address', labelKey: 'warehouses.address' },
    {
      key: 'is_active',
      labelKey: 'items.active',
      render: (r) => t(r.is_active ? 'common.yes' : 'common.no'),
    },
    { key: 'actions', label: '', render: (r) => (
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(r); }} aria-label={t('common.edit')} title={t('common.edit')}>&#9998;</button>
        <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); setConfirmDelete(r); }} aria-label={t('common.delete')} title={t('common.delete')}>&#128465;</button>
      </div>
    )},
  ];

  return (
    <div>
      <PageHeader title={t('nav.warehouses')}>
        <button className="btn btn-primary" onClick={openCreate}>{t('warehouses.newWarehouse')}</button>
      </PageHeader>

      {error && (
        <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>
      )}

      <DataTable columns={columns} data={warehouses} emptyMessageKey="warehouses.empty" />

      {showModal && (
        <Modal
          title={t(editId ? 'warehouses.editWarehouse' : 'warehouses.newWarehouse')}
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowModal(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
            </>
          }
        >
          {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
          {!editId && (
            <div className="form-group">
              <label>{t('bins.code')}</label>
              <input className="form-input" value={form.warehouse_code || ''} onChange={(e) => setForm({ ...form, warehouse_code: e.target.value })} />
            </div>
          )}
          <div className="form-group">
            <label>{t('common.name')}</label>
            <input className="form-input" value={form.warehouse_name || ''} onChange={(e) => setForm({ ...form, warehouse_name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>{t('warehouses.address')}</label>
            <input className="form-input" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          {editId && (
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active === false} onChange={(e) => setForm({ ...form, is_active: !e.target.checked })} />
                {t('warehouses.inactive')}
              </label>
            </div>
          )}
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          title={t('warehouses.confirmDelete')}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" style={{ background: 'var(--copper)' }} onClick={() => deleteWarehouse(confirmDelete.warehouse_id)}>{t('common.delete')}</button>
            </>
          }
        >
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)' }}>{t('warehouses.deleteWarning')}</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{t('warehouses.disableInstead')}</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
            <RichText
              text={t('warehouses.deleteTarget', { name: confirmDelete.warehouse_name })}
              values={{ code: <span className="mono">{confirmDelete.warehouse_code}</span> }}
            />
          </p>
        </Modal>
      )}
    </div>
  );
}
