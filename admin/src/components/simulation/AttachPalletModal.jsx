import { useState } from 'react';
import { api } from '../../api.js';
import { useLocale } from '../../i18n/locale.jsx';
import Modal from '../Modal.jsx';
import {
  apiErrorMessage,
  binStockView,
  normalizeLotNumber,
} from '../../pages/simulation/binModel.js';

/**
 * "Gắn pallet": move a bin's loose (unpalletized) stock onto an empty
 * pallet already in the bin, or onto a new one. Shared by the 2D
 * simulation and the 3D view.
 *
 * Mount it only while open; the form starts from the bin's first empty
 * pallet and the row's whole quantity. onAttached(palletId) runs after a
 * successful attach so the page can reload its map.
 */
export default function AttachPalletModal({
  bin, row, warehouseId, onClose, onAttached,
}) {
  const { t } = useLocale();
  const [form, setForm] = useState(() => {
    const defaultPallet = binStockView(bin).emptyPallets[0]?.pallet_id;
    return {
      pallet_id: defaultPallet ? String(defaultPallet) : 'new',
      quantity: String(row.quantity_on_hand || ''),
    };
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!bin || !row || !warehouseId) return;
    if (!row.item_id) {
      setError(t('warehouseSimulation.attachMissingSku'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      let palletId = form.pallet_id === 'new'
        ? null
        : Number(form.pallet_id);
      if (!Number.isFinite(palletId)) {
        const createRes = await api.post('/admin/pallets', {
          warehouse_id: Number(warehouseId),
          bin_id: Number(bin.bin_id),
          quantity: 0,
        }, { silentPermissionDenied: true });
        if (!createRes?.ok) {
          const data = await createRes?.json().catch(() => ({}));
          throw new Error(apiErrorMessage(data, 'Không tạo được pallet.'));
        }
        const created = await createRes.json();
        palletId = created.pallet_id;
      }
      const qtyRaw = form.quantity !== '' && form.quantity != null
        ? parseInt(String(form.quantity), 10)
        : undefined;
      const body = {
        item_id: Number(row.item_id),
        bin_id: Number(bin.bin_id),
        lot_number: normalizeLotNumber(row.lot_number),
      };
      if (Number.isFinite(qtyRaw) && qtyRaw > 0) body.quantity = qtyRaw;
      const res = await api.post(`/admin/pallets/${palletId}/attach-inventory`, body, { silentPermissionDenied: true });
      if (!res?.ok) {
        const data = await res?.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, 'Không gắn được pallet.'));
      }
      setBusy(false);
      await onAttached?.(palletId);
    } catch (err) {
      setError(err.message || 'Không gắn được pallet.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('warehouseSimulation.attachTitle', {
        item: row.sku || row.item_name,
      })}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
            {busy ? '…' : t('warehouseSimulation.attachPallet')}
          </button>
        </>
      )}
    >
      <p className="sim2-empty-hint" style={{ marginTop: 0 }}>
        {t('warehouseSimulation.attachHint')}
      </p>
      <div className="form-group">
        <label>{t('warehouseSimulation.pallet')}</label>
        <select
          className="form-select"
          value={form.pallet_id || 'new'}
          onChange={(e) => setForm({ ...form, pallet_id: e.target.value })}
        >
          <option value="new">{t('warehouseSimulation.newPallet')}</option>
          {binStockView(bin).emptyPallets.map((p) => (
            <option key={p.pallet_id} value={String(p.pallet_id)}>
              {t('warehouseSimulation.palletEmptyMark', {
                code: p.pallet_code || p.pallet_id,
              })}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>{t('warehouseSimulation.attachQty')}</label>
        <input
          className="form-input"
          type="number"
          min="1"
          max={row.quantity_on_hand}
          value={form.quantity ?? ''}
          onChange={(e) => setForm({ ...form, quantity: e.target.value })}
        />
      </div>
      {row.lot_number && (
        <div className="form-group">
          <label>{t('warehouseSimulation.lot')}</label>
          <input className="form-input" value={row.lot_number} readOnly />
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
