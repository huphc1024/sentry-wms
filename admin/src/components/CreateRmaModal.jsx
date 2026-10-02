import { useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';
import { useLocale } from '../i18n/locale.jsx';

export default function CreateRmaModal({ so, lines, onClose, onCreated }) {
  const { t } = useLocale();
  const returnableLines = (lines || []).filter((l) => (l.quantity_shipped || 0) > 0);

  const [selection, setSelection] = useState(() => {
    const sel = {};
    for (const l of returnableLines) sel[l.so_line_id] = l.quantity_shipped;
    return sel;
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [memo, setMemo] = useState('');

  function setQty(soLineId, qty) {
    setSelection((s) => {
      const next = { ...s };
      if (qty <= 0) delete next[soLineId];
      else next[soLineId] = qty;
      return next;
    });
  }

  function toggle(line) {
    if (selection[line.so_line_id]) setQty(line.so_line_id, 0);
    else setQty(line.so_line_id, line.quantity_shipped || 0);
  }

  async function submit() {
    const body = { lines: [] };
    for (const l of returnableLines) {
      const qty = selection[l.so_line_id];
      if (qty > 0) {
        body.lines.push({
          item_id: l.item_id,
          quantity: qty,
          original_so_line_id: l.so_line_id,
        });
      }
    }
    if (body.lines.length === 0) {
      setError(t('rma.selectLine'));
      return;
    }
    if (memo.trim()) body.memo = memo.trim();
    setSaving(true);
    setError('');
    const res = await api.post(`/admin/sales-orders/${so.so_id}/create-rma`, body);
    if (res?.ok) {
      onCreated?.(await res.json());
    } else {
      const data = await res?.json();
      setError(data?.error || t('rma.failed'));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t('rma.createFor', { so: so.so_number })}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={saving || returnableLines.length === 0}
          >
            {saving ? t('rma.creating') : t('rma.create')}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      {returnableLines.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {t('rma.noLines')}
        </p>
      ) : (
        <table className="lines-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}></th>
              <th>{t('common.sku')}</th>
              <th>{t('common.item')}</th>
              <th style={{ textAlign: 'right' }}>{t('rma.shipped')}</th>
              <th style={{ width: 100, textAlign: 'right' }}>{t('rma.returnQty')}</th>
            </tr>
          </thead>
          <tbody>
            {returnableLines.map((l) => {
              const shipped = l.quantity_shipped || 0;
              const qty = selection[l.so_line_id] ?? 0;
              const checked = qty > 0;
              return (
                <tr key={l.so_line_id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={checked}
                      data-testid={`create-rma-line-${l.sku}`}
                      onChange={() => toggle(l)}
                    />
                  </td>
                  <td className="mono">{l.sku}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{l.item_name}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{shipped}</td>
                  <td style={{ textAlign: 'right' }}>
                    <input
                      type="number" min={1} max={shipped}
                      className="form-input mono"
                      style={{ width: 80, textAlign: 'right', padding: '4px 8px' }}
                      value={checked ? qty : ''}
                      disabled={!checked}
                      data-testid={`create-rma-qty-${l.sku}`}
                      onChange={(e) =>
                        setQty(
                          l.so_line_id,
                          Math.min(shipped, Math.max(0, parseInt(e.target.value, 10) || 0)),
                        )
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {returnableLines.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
            {t('rma.noteOptional')}
          </label>
          <textarea
            className="form-input"
            rows={2}
            placeholder={t('rma.notePlaceholder')}
            value={memo}
            data-testid="create-rma-memo"
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
      )}
    </Modal>
  );
}
