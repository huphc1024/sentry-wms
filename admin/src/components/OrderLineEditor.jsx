import SkuBarcodeAutocomplete from './SkuBarcodeAutocomplete.jsx';
import { useLocale } from '../i18n/locale.jsx';
import { emptyOrderLine } from '../utils/orderLines.js';

/**
 * Row editor for the Create PO / Create SO modals: type or scan a SKU,
 * set a quantity, add or drop a row. The resolution helpers live in
 * utils/orderLines.js so this file exports only a component.
 */
export default function OrderLineEditor({ lines, onChange, listIdPrefix = 'order', disabled = false }) {
  const { t } = useLocale();
  function updateLine(index, patch) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    onChange([...lines, emptyOrderLine()]);
  }

  function removeLine(index) {
    // Always leave one row standing: an empty editor gives the operator
    // nothing to click and no way back to a usable form.
    onChange(lines.length === 1 ? [emptyOrderLine()] : lines.filter((_, i) => i !== index));
  }

  return (
    <div>
      <table className="data-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th style={{ width: '55%' }}>{t('common.sku')}</th>
            <th style={{ width: '25%' }}>{t('common.quantity')}</th>
            <th style={{ width: '20%' }} aria-label={t('orderLineEditor.removeLine')} />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={index}>
              <td style={{ verticalAlign: 'top' }}>
                <SkuBarcodeAutocomplete
                  className="form-input mono"
                  listId={`${listIdPrefix}-sku-${index}`}
                  minChars={2}
                  placeholder={t('orderLineEditor.skuPlaceholder')}
                  value={line.sku}
                  disabled={disabled}
                  onChange={(value) => updateLine(index, { sku: value, item: null })}
                  onItemSelect={(item) => updateLine(index, {
                    sku: item?.sku || line.sku,
                    item: item || null,
                  })}
                  showNoMatch
                />
                {line.item && (
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--success)' }}>
                    {line.item.item_name}
                  </div>
                )}
              </td>
              <td style={{ verticalAlign: 'top' }}>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  step={1}
                  placeholder="0"
                  value={line.quantity_ordered}
                  disabled={disabled}
                  onChange={(e) => updateLine(index, { quantity_ordered: e.target.value })}
                />
              </td>
              <td style={{ verticalAlign: 'top' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => removeLine(index)}
                  disabled={disabled || (lines.length === 1 && !line.sku && !line.quantity_ordered)}
                  aria-label={t('orderLineEditor.removeLine')}
                  title={t('orderLineEditor.removeLine')}
                >
                  &#10005;
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn btn-sm"
        onClick={addLine}
        disabled={disabled}
        style={{ marginTop: 8 }}
      >
        {t('orderLineEditor.addLine')}
      </button>
    </div>
  );
}
