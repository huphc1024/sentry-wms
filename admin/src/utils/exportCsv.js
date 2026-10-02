/**
 * CSV export for list screens.
 *
 * Lifted out of DataTable unchanged so a page built on Ant Design's Table
 * can offer the same download. Operators export a filtered list and open
 * it in Excel several times a day; a migrated page that silently lost the
 * button would read as a regression, not a redesign.
 */

/**
 * Quote a cell, and defuse the leading characters Excel treats as the
 * start of a formula. A vendor literally named "=cmd" is a spreadsheet
 * injection, so it is prefixed with an apostrophe and stays text.
 */
export function sanitizeCsvValue(val) {
  if (typeof val !== 'string') return val ?? '';
  const escaped = `"${val.replace(/"/g, '""')}"`;
  if (/^[=+\-@\t\r]/.test(val)) return `"'${val.replace(/"/g, '""')}"`;
  return escaped;
}

/**
 * Resolve one cell for export.
 *
 * `render` often returns a React element (a status pill, a link), which
 * would serialize as "[object Object]", so an element falls back to the
 * raw field. A column can override everything with `csvValue`.
 */
export function computeCellValue(col, row) {
  if (col.csvValue) return col.csvValue(row);
  if (col.render) {
    const rendered = col.render(row);
    if (rendered === null || rendered === undefined) return row[col.key];
    if (typeof rendered !== 'object') return rendered;
  }
  return row[col.key];
}

/**
 * Build the CSV text for `data` under `columns`.
 *
 * `heading` is handed the whole column rather than its label, because
 * a column carries its heading either as `labelKey` (a message key) or
 * as `label` (English text the old dictionary matched on), and only the
 * caller knows how to resolve each. Passing the label alone would have
 * exported the English header from every page that had been converted.
 */
export function buildCsv(columns, data, heading = (col) => col.label) {
  const headers = columns.map((c) => heading(c));
  const rows = data.map((row) => columns.map((c) => sanitizeCsvValue(computeCellValue(c, row))));
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

/** Build and hand the browser a CSV download. No-op on an empty list. */
export function downloadCsv(columns, data, heading) {
  if (!data || data.length === 0) return;
  const csv = buildCsv(columns, data, heading);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${new Date().toISOString().slice(0, 10)}InvExport.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
