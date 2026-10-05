import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import AiSuggestions from '../components/AiSuggestions.jsx';
import { useLocale } from '../i18n/locale.jsx';

// Dashboard view of staging bins for the supervisor. Grid of
// rounded-rectangle bin tiles, alphabetised, with a red border for
// bins that have items awaiting put-away and a grey border for empty
// ones. Clicking a populated tile opens the item breakdown in a modal
// with a per-bin CSV export; an all-data CSV sits in the page header.
// Auto-fit grid means the row count flexes 8-12+ wide depending on
// viewport.

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, headerRow, dataRows) {
  const lines = [headerRow.join(',')];
  for (const r of dataRows) lines.push(r.map(csvEscape).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function PutAway() {
  const { t } = useLocale();
  const { warehouseId } = useWarehouse();
  const [bins, setBins] = useState([]);
  const [focusedBin, setFocusedBin] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!warehouseId) return;
    setLoading(true);
    api.get(`/putaway/staging-summary/${warehouseId}`).then(async (res) => {
      setLoading(false);
      if (!res?.ok) return;
      const data = await res.json();
      setBins(data.bins || []);
    }).catch(() => setLoading(false));
  }, [warehouseId]);

  function exportAll() {
    const header = ['Bin', 'SKU', 'Item Name', 'UPC', 'Quantity', 'Suggested Bin', 'Lot'];
    const rows = [];
    for (const b of bins) {
      for (const item of b.items) {
        rows.push([
          b.bin_code, item.sku, item.item_name, item.upc || '',
          item.quantity_on_hand, item.suggested_bin || '', item.lot_number || '',
        ]);
      }
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`putaway-staging-wh${warehouseId}-${stamp}.csv`, header, rows);
  }

  function exportBin(bin) {
    const header = ['SKU', 'Item Name', 'UPC', 'Quantity', 'Suggested Bin', 'Lot'];
    const rows = bin.items.map((item) => [
      item.sku, item.item_name, item.upc || '',
      item.quantity_on_hand, item.suggested_bin || '', item.lot_number || '',
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`putaway-${bin.bin_code}-${stamp}.csv`, header, rows);
  }

  const totalSkus = bins.reduce((acc, b) => acc + b.sku_count, 0);
  const totalQty = bins.reduce((acc, b) => acc + b.total_qty, 0);
  const binsWithItems = bins.reduce((acc, b) => acc + (b.sku_count > 0 ? 1 : 0), 0);

  return (
    <div>
      <PageHeader title={t('nav.putaway')}>
        <button
          className="btn"
          onClick={exportAll}
          disabled={bins.length === 0}
          title={t('putAway.exportAllTooltip')}
        >
          {t('putAway.exportAll')}
        </button>
      </PageHeader>

      <div style={{
        display: 'flex', gap: 16, marginBottom: 16, fontSize: 13,
        color: 'var(--text-secondary)',
      }}>
        <span>
          <strong style={{ color: 'var(--text)' }}>{binsWithItems}</strong>
          {' / '}{t('putAway.stagingBinsWithItems', { total: bins.length })}
        </span>
        <span>
          <strong style={{ color: 'var(--text)' }}>{totalSkus}</strong>{' '}
          {t('putAway.totalSkuRows')}
        </span>
        <span>
          <strong style={{ color: 'var(--text)' }}>{totalQty}</strong>{' '}
          {t('putAway.totalUnits')}
        </span>
      </div>

      {warehouseId && (
        <AiSuggestions
          kind="putaway"
          warehouseId={warehouseId}
          request={() => ({ path: '/admin/ai/putaway', body: { warehouse_id: warehouseId } })}
        />
      )}

      {loading && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('common.loading')}</p>
      )}
      {!loading && bins.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {t('putAway.noStagingBins')}
        </p>
      )}

      <div className="putaway-grid">
        {bins.map((b) => {
          const isEmpty = b.sku_count === 0;
          return (
            <button
              key={b.bin_id}
              type="button"
              className={`putaway-tile ${isEmpty ? 'empty' : 'has-items'}`}
              onClick={isEmpty ? undefined : () => setFocusedBin(b)}
              disabled={isEmpty}
              title={isEmpty
                ? `${b.bin_code} - empty`
                : t('putAway.tileTooltip', {
                  bin: b.bin_code,
                  skus: b.sku_count,
                  units: b.total_qty,
                })}
            >
              <div className="putaway-tile-label">{b.bin_code}</div>
              <div className="putaway-tile-count">
                {isEmpty ? 'empty' : `${b.sku_count} SKU${b.sku_count === 1 ? '' : 's'}`}
              </div>
            </button>
          );
        })}
      </div>

      {focusedBin && (
        <Modal
          title={t('putAway.binTitle', {
            bin: focusedBin.bin_code,
            skus: focusedBin.sku_count,
            units: focusedBin.total_qty,
          })}
          onClose={() => setFocusedBin(null)}
          size="wide"
          footer={
            <>
              <button className="btn" onClick={() => exportBin(focusedBin)}>
                {t('putAway.exportBin', { bin: focusedBin.bin_code })}
              </button>
              <button className="btn btn-primary" onClick={() => setFocusedBin(null)}>{t('common.close')}</button>
            </>
          }
        >
          <table className="lines-table">
            <thead>
              <tr>
                <th>{t('common.sku')}</th>
                <th>{t('common.itemName')}</th>
                <th>{t('common.upc')}</th>
                <th style={{ textAlign: 'right' }}>{t('common.qty')}</th>
                <th>{t('putAway.suggestedBin')}</th>
                <th>{t('warehouseSimulation.lot')}</th>
              </tr>
            </thead>
            <tbody>
              {focusedBin.items.map((it) => (
                <tr key={it.inventory_id}>
                  <td className="mono">{it.sku}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{it.item_name}</td>
                  <td className="mono">{it.upc || '-'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{it.quantity_on_hand}</td>
                  <td className="mono">{it.suggested_bin || '-'}</td>
                  <td className="mono">{it.lot_number || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}
