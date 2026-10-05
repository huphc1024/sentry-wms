/** Build native <datalist> options from items (SKU, UPC, barcode aliases). */
export function buildItemScanOptions(items) {
  const options = [];
  const seen = new Set();

  const add = (value, label, item) => {
    const v = String(value || '').trim();
    if (!v || seen.has(v.toLowerCase())) return;
    seen.add(v.toLowerCase());
    options.push({ value: v, label: label || v, item });
  };

  for (const item of items || []) {
    const name = item.item_name || '';
    add(item.sku, name ? `${item.sku} — ${name}` : item.sku, item);
    if (item.upc) add(item.upc, name ? `${item.upc} — ${name} (UPC)` : item.upc, item);
    for (const alias of item.barcode_aliases || []) {
      add(alias, name ? `${alias} — ${name}` : alias, item);
    }
  }

  return options;
}

/** Exact match on SKU, UPC, or barcode alias (case-insensitive). */
export function resolveItemFromScan(value, items) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return null;

  for (const item of items || []) {
    if (String(item.sku || '').trim().toLowerCase() === key) return item;
    if (item.upc && String(item.upc).trim().toLowerCase() === key) return item;
    for (const alias of item.barcode_aliases || []) {
      if (String(alias).trim().toLowerCase() === key) return item;
    }
  }

  return null;
}
