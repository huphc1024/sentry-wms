import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { useWarehouse } from '../warehouse.jsx';
import { useLocale } from '../i18n/locale.jsx';

const EMPTY = {
  movement_type: 'INBOUND',
  vehicle_plate: '',
  driver_name: '',
  reference_type: 'PO',
  reference_id: '',
  related_pallet_id: '',
  notes: '',
};

export default function VehicleMovements() {
  const { t } = useLocale();
  const { warehouseId } = useWarehouse();
  const [movements, setMovements] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    if (!warehouseId) return;
    const qs = new URLSearchParams({
      warehouse_id: String(warehouseId),
      per_page: '200',
    });
    if (statusFilter) qs.set('status', statusFilter);
    const res = await api.get(`/admin/vehicle-movements?${qs}`);
    if (res?.ok) setMovements((await res.json()).movements || []);
  }, [warehouseId, statusFilter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function createMovement() {
    if (!warehouseId) {
      setError(t('vehicleMovements.pickWarehouseFirst'));
      return;
    }
    if (!form?.movement_type || !form?.vehicle_plate) {
      setError(t('vehicleMovements.typeAndPlateRequired'));
      return;
    }
    setBusy(true);
    setError('');
    const res = await api.post('/admin/vehicle-movements', {
      warehouse_id: warehouseId,
      movement_type: form.movement_type,
      vehicle_plate: form.vehicle_plate,
      driver_name: form.driver_name || null,
      reference_type: form.reference_id ? form.reference_type : null,
      reference_id: form.reference_id ? Number(form.reference_id) : null,
      related_pallet_id: form.related_pallet_id ? Number(form.related_pallet_id) : null,
      notes: form.notes || null,
    });
    setBusy(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setError(data?.error || 'Không ghi nhận được xe');
      return;
    }
    setForm(null);
    await load();
  }

  async function completeMovement(row) {
    setBusy(true);
    setError('');
    const res = await api.post(`/admin/vehicle-movements/${row.movement_id}/complete`, {});
    setBusy(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setError(data?.error || 'Không hoàn tất được phiên cổng');
      return;
    }
    await load();
  }

  const columns = [
    { key: 'recorded_at', labelKey: 'vehicleMovements.time', render: (row) => (row.recorded_at || '').replace('T', ' ').slice(0, 19) },
    { key: 'movement_type', labelKey: 'common.type' },
    { key: 'vehicle_plate', labelKey: 'vehicleMovements.plate', render: (row) => <span className="mono">{row.vehicle_plate}</span> },
    { key: 'driver_name', labelKey: 'vehicleMovements.driver', render: (row) => row.driver_name || '—' },
    {
      key: 'reference_number',
      label: 'PO / SO',
      render: (row) => (
        row.reference_type
          ? `${row.reference_type} ${row.reference_number || `#${row.reference_id}`}`
          : '—'
      ),
    },
    { key: 'pallet_code', labelKey: 'warehouseSimulation.pallet', render: (row) => row.pallet_code || '—' },
    {
      key: 'status',
      labelKey: 'common.status',
      render: (row) => (
        <span className={`status-tag status-${String(row.status).toLowerCase()}`}>{row.status}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        (row.status === 'CHECKED_IN' || row.status === 'IN_PROGRESS')
          ? (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => completeMovement(row)}
            >
              {t('vehicleMovements.complete')}
            </button>
          )
          : null
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('nav.vehicleMovements')}>
        <select
          className="form-input"
          style={{ width: 'auto' }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">{t('dashboard.allStatuses')}</option>
          {['CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((st) => (
            <option key={st} value={st}>{t(`status.${st}`)}</option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setError('');
            setForm({
              ...EMPTY,
              reference_type: 'PO',
            });
          }}
        >
          {t('vehicleMovements.checkIn')}
        </button>
      </PageHeader>

      {!warehouseId && (
        <div className="alert alert-info">{t('vehicleMovements.pickWarehouse')}</div>
      )}
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <DataTable columns={columns} data={movements} rowKey="movement_id" />

      {form && (
        <Modal
          title={t('vehicleMovements.checkInTitle')}
          onClose={() => setForm(null)}
          footer={(
            <>
              <button type="button" className="btn" onClick={() => setForm(null)}>{t('common.cancel')}</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={createMovement}>
                {t('vehicleMovements.saveSession')}
              </button>
            </>
          )}
        >
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="vm-type">{t('vehicleMovements.typeRequired')}</label>
              <select
                id="vm-type"
                className="form-input"
                value={form.movement_type}
                onChange={(e) => setForm({
                  ...form,
                  movement_type: e.target.value,
                  reference_type: e.target.value === 'INBOUND' ? 'PO' : 'SO',
                  reference_id: '',
                })}
              >
                <option value="INBOUND">{t('vehicleMovements.inbound')}</option>
                <option value="OUTBOUND">{t('vehicleMovements.outbound')}</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="vm-plate">{t('vehicleMovements.plateRequired')}</label>
              <input
                id="vm-plate"
                className="form-input"
                value={form.vehicle_plate}
                onChange={(e) => setForm({ ...form, vehicle_plate: e.target.value.toUpperCase() })}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="vm-driver">{t('vehicleMovements.driver')}</label>
              <input
                id="vm-driver"
                className="form-input"
                value={form.driver_name}
                onChange={(e) => setForm({ ...form, driver_name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="vm-ref-id">
                {t(form.movement_type === 'INBOUND'
                  ? 'vehicleMovements.poId'
                  : 'vehicleMovements.soId')}
              </label>
              <input
                id="vm-ref-id"
                className="form-input"
                value={form.reference_id}
                onChange={(e) => setForm({ ...form, reference_id: e.target.value })}
                placeholder={t('vehicleMovements.idPlaceholder')}
              />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="vm-pallet">{t('vehicleMovements.palletId')}</label>
            <input
              id="vm-pallet"
              className="form-input"
              value={form.related_pallet_id}
              onChange={(e) => setForm({ ...form, related_pallet_id: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label htmlFor="vm-notes">{t('common.notes')}</label>
            <textarea
              id="vm-notes"
              className="form-input"
              rows="3"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="alert alert-info">
            INBOUND gắn PO → mở phiên nhận hàng. OUTBOUND gắn SO → mở phiên xuất/ship.
            Khi PO nhận đủ hoặc SO ship, phiên tự hoàn tất và phát webhook đối tác.
          </div>
        </Modal>
      )}
    </div>
  );
}
