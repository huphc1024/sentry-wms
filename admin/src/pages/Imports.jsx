import { useState, useRef } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import { useLocale } from '../i18n/locale.jsx';

// Every template must include every field the corresponding import
// endpoint treats as required OR meaningfully useful. Issue #91: the
// prior templates were missing warehouse_id on PO/SO (always required
// by the import helper) and several column-scope fields on Bins/Items.
// Operators who downloaded a template, filled it, and imported without
// editing the column list got row-level "Missing required field"
// errors. Keeping the templates in lockstep with the pydantic schemas
// in api/schemas/csv_import.py is the only way to close that loop.
// Exported for alignment tests in admin/src/test/imports.test.jsx.
export const CSV_TEMPLATES = {
  items: `sku,name,description,category,upc,default_bin,weight,quantity
WIDGET-001,Blue Widget,Standard blue widget,Widgets,012345678901,A-01-01-01,0.50,100
WIDGET-002,Red Widget,Standard red widget,Widgets,012345678902,A-01-01-02,0.50,50
GADGET-001,Mini Gadget,Compact gadget device,Gadgets,012345678903,B-02-01-01,0.25,200`,
  'purchase-orders': `po_number,warehouse_id,vendor,sku,quantity,expected_date
PO-1001,1,Acme Supply Co,WIDGET-001,100,2026-05-01
PO-1001,1,Acme Supply Co,WIDGET-002,50,2026-05-01
PO-1002,1,Global Parts Inc,GADGET-001,200,2026-05-15`,
  'sales-orders': `so_number,warehouse_id,customer,customer_phone,customer_address,sku,quantity
SO-5001,1,John Smith,555-0101,123 Main St,WIDGET-001,2
SO-5001,1,John Smith,555-0101,123 Main St,GADGET-001,1
SO-5002,1,Jane Doe,555-0102,456 Oak Ave,WIDGET-002,3`,
  bins: `bin_code,bin_barcode,zone,warehouse_id,aisle,bin_type,pick_sequence,putaway_sequence,description
C-01-01-01,C-01-01-01,STORAGE,1,C,Pickable,100,100,Shelf C Row 1 Level 1
C-01-02-01,C-01-02-01,STORAGE,1,C,Pickable,101,101,Shelf C Row 2 Level 1
D-01-01-01,D-01-01-01,PICKING,1,D,Pickable,200,200,Pick zone D`,
  'inventory-adjustments': `sku,warehouse,bin,qty,memo
WIDGET-001,WH-01,PICK-01,5,Found stock during cycle count
WIDGET-002,WH-01,PICK-02,-3,Damaged in handling
GADGET-001,WH-01,BULK-01,10,Vendor credit`,
};

function downloadTemplate(type) {
  const csv = CSV_TEMPLATES[type];
  if (!csv) return;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `import-${type}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const IMPORT_TYPES = [
  { value: 'items', labelKey: 'nav.items', descKey: 'imports.descItems' },
  { value: 'bins', labelKey: 'nav.bins', descKey: 'imports.descBins' },
  { value: 'purchase-orders', labelKey: 'nav.purchaseOrders', descKey: 'imports.descPos' },
  { value: 'sales-orders', labelKey: 'nav.salesOrders', descKey: 'imports.descSos' },
  {
    value: 'inventory-adjustments',
    labelKey: 'nav.adjustments',
    descKey: 'imports.descAdjustments',
  },
];

export default function Imports() {
  const { t } = useLocale();
  const [importType, setImportType] = useState('items');
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  async function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setImportResult(null);
    setImporting(true);

    try {
      const text = await file.text();
      let rows;

      if (file.name.endsWith('.json')) {
        rows = JSON.parse(text);
      } else {
        const lines = text.trim().split('\n');
        const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
        rows = lines.slice(1).map((line) => {
          const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
          const obj = {};
          headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
          return obj;
        });
      }

      const res = await api.post(`/admin/import/${importType}`, { records: rows });
      if (res?.ok) {
        const data = await res.json();
        setImportResult(data);
      } else {
        const data = await res?.json();
        setImportResult({ error: data?.error || t('imports.failed') });
      }
    } catch (err) {
      setImportResult({ error: t('imports.parseFailed') });
    }
    setImporting(false);
    fileRef.current.value = '';
  }

  return (
    <div>
      <PageHeader title={t('nav.import')} />

      <div className="settings-section">
        <h3>{t('imports.importData')}</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {/* The map used to bind `t`, which now names the translator. */}
          {IMPORT_TYPES.map((kind) => (
            <button
              key={kind.value}
              className={`btn ${importType === kind.value ? 'btn-primary' : ''}`}
              onClick={() => { setImportType(kind.value); setImportResult(null); }}
            >
              {t(kind.labelKey)}
            </button>
          ))}
        </div>
        <p className="settings-note">
          {t(IMPORT_TYPES.find((kind) => kind.value === importType)?.descKey)}
        </p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          <input ref={fileRef} type="file" accept=".csv,.json" style={{ fontSize: 13 }} />
          <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
            {t(importing ? 'imports.importing' : 'nav.import')}
          </button>
          <button className="btn btn-sm" onClick={() => downloadTemplate(importType)} style={{ fontSize: 12 }}>
            {t('imports.downloadTemplate')}
          </button>
        </div>
      </div>

      {importResult && (
        <div className="settings-section">
          <h3>{t('imports.results')}</h3>
          <div className="import-results">
            {importResult.error ? (
              <div className="errors">{importResult.error}</div>
            ) : (
              <>
                <div className="success">{t('imports.imported', { n: importResult.imported ?? 0 })}</div>
                {importResult.errors?.length > 0 && (
                  <div className="errors" style={{ marginTop: 4 }}>
                    {t('imports.errors', { n: importResult.errors.length })}
                    <ul style={{ margin: '4px 0 0 16px', fontSize: 12 }}>
                      {importResult.errors.slice(0, 20).map((err, i) => (
                        <li key={i}>
                          {t('imports.rowError', { row: err.row })} {err.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
