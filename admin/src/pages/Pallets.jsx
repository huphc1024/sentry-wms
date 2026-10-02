import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { useWarehouse } from '../warehouse.jsx';
import { useLocale } from '../i18n/locale.jsx';

export default function Pallets() {
  const { t } = useLocale();
  const { warehouseId, warehouse } = useWarehouse();
  const [pallets, setPallets] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({});
  const [labelPallet, setLabelPallet] = useState(null);

  useEffect(() => { loadPallets(); }, [page, warehouseId]); // eslint-disable-line

  async function loadPallets() {
    const filter = warehouseId ? `&warehouse_id=${warehouseId}` : '';
    const res = await api.get(`/admin/pallets?page=${page}${filter}`);
    if (res?.ok) {
      const data = await res.json();
      setPallets(data.pallets || []);
      setPagination({ page: data.page, pages: data.pages, total: data.total, per_page: data.per_page });
    }
  }

  async function createPallet() {
    const body = {
      pallet_code: form.pallet_code,
      pallet_barcode: form.pallet_barcode,
      item_id: form.item_id ? Number(form.item_id) : null,
      warehouse_id: Number(form.warehouse_id),
      customer_id: form.customer_id || null,
      bin_id: form.bin_id ? Number(form.bin_id) : null,
      quantity: Number(form.quantity) || 0,
      weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
      lot_code: form.lot_code || null,
      expiry_date: form.expiry_date || null,
    };
    const res = await api.post('/admin/pallets', body);
    if (res?.ok) {
      const data = await res.json();
      setShowCreate(false);
      setForm({});
      setLabelPallet({
        pallet_code: data.pallet_code,
        pallet_barcode: data.pallet_barcode,
      });
      loadPallets();
    } else {
      const data = await res?.json();
      alert(data?.error || 'Failed');
    }
  }

  async function generatePalletCode() {
    const selectedWarehouseId = Number(form.warehouse_id || warehouseId);
    if (!selectedWarehouseId) {
      alert(t('pallets.pickWarehouseFirst'));
      return;
    }
    const res = await api.get(`/admin/pallets/next-code?warehouse_id=${selectedWarehouseId}`);
    if (!res?.ok) return;
    const data = await res.json();
    setForm((current) => ({
      ...current,
      warehouse_id: selectedWarehouseId,
      pallet_code: data.pallet_code,
      pallet_barcode: data.pallet_code,
    }));
  }

  const columns = [
    { key: 'pallet_code', labelKey: 'warehouseSimulation.pallet' },
    { key: 'pallet_barcode', labelKey: 'pallets.qrBarcode' },
    { key: 'sku', labelKey: 'common.sku' },
    { key: 'quantity', labelKey: 'common.qty' },
    { key: 'expiry_date', labelKey: 'warehouseSimulation.expiry' },
    { key: 'bin_id', labelKey: 'common.bin' },
    { key: 'status', labelKey: 'common.status' },
  ];

  return (
    <div>
      <PageHeader title={t('nav.pallets')}>
        <button className="btn btn-primary" onClick={() => {
          setShowCreate(true);
          setForm({ warehouse_id: warehouseId || '' });
        }}>{t('warehouseSimulation.createPallet')}</button>
      </PageHeader>
      <DataTable columns={columns} data={pallets} rowKey="pallet_id" pagination={pagination} onPageChange={setPage} />

      {showCreate && (
        <Modal title={t('pallets.newPallet')} onClose={() => setShowCreate(false)} footer={
          <>
            <button className="btn" onClick={() => setShowCreate(false)}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={createPallet}>{t('common.create')}</button>
          </>
        }>
          <div className="form-row">
            <div className="form-group">
              <label>{t('warehouseSimulation.palletCode')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="form-input" placeholder={`${warehouse?.warehouse_code || 'KHO'}-PLT-00001`} value={form.pallet_code || ''} onChange={(e) => setForm({ ...form, pallet_code: e.target.value })} />
                <button type="button" className="btn" onClick={generatePalletCode}>{t('pallets.generateCode')}</button>
              </div>
              <small style={{ color: 'var(--text-secondary)' }}>{t('pallets.qrHint')}</small>
            </div>
            <div className="form-group">
              <label>{t('pallets.itemIdLabel')}</label>
              <input className="form-input" value={form.item_id || ''} onChange={(e) => setForm({ ...form, item_id: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('pallets.customerCanonicalId')}</label>
              <input className="form-input" value={form.customer_id || ''} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('pallets.warehouseId')}</label>
              <input className="form-input" value={form.warehouse_id || ''} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('pallets.binId')}</label>
              <input className="form-input" value={form.bin_id || ''} onChange={(e) => setForm({ ...form, bin_id: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('salesOrders.quantity')}</label>
              <input className="form-input" type="number" value={form.quantity || ''} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('pallets.weightKg')}</label>
              <input className="form-input" type="number" value={form.weight_kg || ''} onChange={(e) => setForm({ ...form, weight_kg: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>{t('pallets.lotCode')}</label>
            <input className="form-input" value={form.lot_code || ''} onChange={(e) => setForm({ ...form, lot_code: e.target.value })} />
          </div>
          <div className="form-group">
            <label>{t('warehouseSimulation.expiry')}</label>
            <input className="form-input" type="date" value={form.expiry_date || ''} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
          </div>
        </Modal>
      )}

      {labelPallet && (
        <Modal title={t('pallets.qrLabelTitle')} onClose={() => setLabelPallet(null)} footer={
          <>
            <button className="btn" onClick={() => setLabelPallet(null)}>{t('common.close')}</button>
            <button className="btn btn-primary" onClick={() => window.print()}>{t('pallets.printLabel')}</button>
          </>
        }>
          <div style={{ display: 'grid', justifyItems: 'center', gap: 12, padding: 12, textAlign: 'center' }}>
            <QRCodeSVG value={labelPallet.pallet_barcode || labelPallet.pallet_code} size={200} level="M" includeMargin />
            <strong style={{ fontSize: 18 }}>{labelPallet.pallet_code}</strong>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('pallets.scanHint')}</span>
          </div>
        </Modal>
      )}
    </div>
  );
}

