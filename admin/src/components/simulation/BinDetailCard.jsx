import { useLocale } from '../../i18n/locale.jsx';
import { binStockView } from '../../pages/simulation/binModel.js';

/**
 * What one bin holds: pallets with stock, empty pallets, and stock that
 * sits in the bin without a pallet. Shared by the 2D simulation and the
 * 3D view; each page passes its own actions.
 *
 * onMoveIntoPallet / onAttachPallet are optional -- leave one out and its
 * button is not drawn. `children` renders under the lists (page actions).
 */
export default function BinDetailCard({
  bin,
  selectedPallet,
  onSelectPallet,
  onMoveIntoPallet,
  onAttachPallet,
  style,
  children,
}) {
  const { t } = useLocale();
  if (!bin) return null;
  const stock = binStockView(bin);
  const hasAnything = stock.pallets.length
    || stock.emptyPallets.length
    || stock.unpalletized.length;
  return (
    <div className="sim2-detail-card" style={style}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>
        {t('warehouseSimulation.binN', { code: bin.bin_code })}
      </div>
      <div className="sim2-detail-row"><span>{t('common.onHand')}</span><strong>{bin.total_qty}</strong></div>
      {stock.pallets.length > 0 && (
        <div className="sim2-pallet-list">
          <div className="sim2-pallet-list-title">{t('warehouseSimulation.palletsWithStock')}</div>
          {stock.pallets.map((pallet) => (
            <button
              key={pallet.pallet_id}
              type="button"
              className={`sim-slot-pallet-item sim2-stock-row sim2-pallet-row${selectedPallet === pallet.pallet_id ? ' is-active' : ''}`}
              onClick={() => onSelectPallet?.(pallet.pallet_id)}
            >
              <div className="sim2-stock-main">
                <span className="sim2-pallet-code">{pallet.pallet_code || pallet.pallet_id}</span>
                <div className="sim2-stock-head">
                  <span className="sim2-sku">{pallet.sku || '-'}</span>
                  {pallet.item_name && <span className="sim2-item-name" title={pallet.item_name}>{pallet.item_name}</span>}
                </div>
                <div className="sim2-stock-meta">
                  <span className="sim2-chip sim2-chip-qty">
                    {t('warehouseSimulation.qtyN', { qty: pallet.quantity_on_hand ?? 0 })}
                  </span>
                  {pallet.lot_code && (
                    <span className="sim2-chip">{t('warehouseSimulation.lotN', { lot: pallet.lot_code })}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {stock.emptyPallets.length > 0 && (
        <div className="sim2-pallet-list">
          <div className="sim2-pallet-list-title">{t('warehouseSimulation.emptyPallets')}</div>
          {stock.emptyPallets.map((pallet) => (
            <div key={pallet.pallet_id} className="sim-slot-pallet-item" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className={`sim-slot-pallet-item${selectedPallet === pallet.pallet_id ? ' is-active' : ''}`}
                onClick={() => onSelectPallet?.(pallet.pallet_id)}
                style={{ flex: '1 1 160px', textAlign: 'left' }}
              >
                <strong>{pallet.pallet_code || pallet.pallet_id}</strong>
                <span>{t('warehouseSimulation.emptyReady')}</span>
              </button>
              {onMoveIntoPallet && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => onMoveIntoPallet(pallet.pallet_id)}
                >
                  {t('warehouseSimulation.moveIn')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {stock.unpalletized.length > 0 && (
        <div className="sim2-pallet-list">
          <div className="sim2-pallet-list-title">{t('warehouseSimulation.unpalletized')}</div>
          {stock.unpalletized.map((row) => (
            <div key={`${row.item_id}-${row.lot_number || 'x'}`} className="sim-slot-pallet-item sim2-stock-row">
              <div className="sim2-stock-main">
                <div className="sim2-stock-head">
                  <span className="sim2-sku">{row.sku || row.item_id}</span>
                  {row.item_name && <span className="sim2-item-name" title={row.item_name}>{row.item_name}</span>}
                </div>
                <div className="sim2-stock-meta">
                  <span className="sim2-chip sim2-chip-qty">
                    {t('warehouseSimulation.qtyN', { qty: row.quantity_on_hand ?? 0 })}
                  </span>
                  {row.lot_number && (
                    <span className="sim2-chip">{t('warehouseSimulation.lotN', { lot: row.lot_number })}</span>
                  )}
                </div>
              </div>
              {onAttachPallet && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => onAttachPallet(row)}>
                  {t('warehouseSimulation.attachPallet')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!hasAnything && (
        <div className="sim2-empty-hint">{t('warehouseSimulation.binEmpty')}</div>
      )}
      {children}
    </div>
  );
}
