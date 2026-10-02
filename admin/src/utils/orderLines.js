import { api } from '../api.js';
import { resolveItemFromScan } from './itemScanOptions.js';

/**
 * Order-line helpers shared by the Create PO and Create SO modals.
 *
 * Both endpoints take `lines: [{item_id, quantity_ordered}]`, so the
 * operator-facing half -- type or scan a SKU, set a quantity, add or drop
 * a row -- is identical and lives here. Each page keeps its own header
 * fields, which are not shared at all (vendor and expected date on one
 * side, customer and ship method on the other).
 *
 * A row carries the resolved `item` when the operator picked it from the
 * autocomplete, so submitting does not re-query for something already
 * identified. A row typed by hand (or filled by a scanner gun that never
 * opens the dropdown) resolves at submit time instead.
 */

export function emptyOrderLine() {
  return { sku: '', quantity_ordered: '', item: null };
}

/** Resolve one typed or scanned SKU / barcode to an item_id. */
export async function resolveSkuToItemId(sku) {
  const key = String(sku || '').trim();
  if (!key) return null;
  const res = await api.get(
    `/admin/items?q=${encodeURIComponent(key)}&per_page=10&active=true`,
  );
  if (!res?.ok) return null;
  const data = await res.json();
  const match = resolveItemFromScan(key, data.items || []);
  return match ? match.item_id : null;
}

/**
 * Turn editor rows into the `lines` payload both create endpoints expect.
 *
 * Returns `{ lines }` on success or `{ error }` naming the offending row,
 * so the caller can surface which SKU failed rather than a generic
 * "invalid request". Unresolved SKUs are rejected here instead of being
 * sent on, because the server answers a missing item_id with a 400 that
 * names an internal id the operator has never seen.
 */
export async function resolveOrderLines(rows) {
  const entries = (rows || []).filter((r) => String(r.sku || '').trim());
  if (entries.length === 0) {
    return { error: 'Add at least one line.' };
  }

  for (const row of entries) {
    const qty = Number(row.quantity_ordered);
    if (!Number.isInteger(qty) || qty <= 0) {
      return { error: `Quantity for ${row.sku.trim()} must be a whole number above 0.` };
    }
  }

  // Resolve every unknown SKU in parallel: a ten-line order should cost
  // one round-trip's worth of latency, not ten.
  const resolved = await Promise.all(
    entries.map(async (row) => (
      row.item?.item_id ? row.item.item_id : resolveSkuToItemId(row.sku)
    )),
  );

  const seen = new Set();
  const lines = [];
  for (let i = 0; i < entries.length; i++) {
    const itemId = resolved[i];
    const sku = entries[i].sku.trim();
    if (!itemId) return { error: `Unknown SKU: ${sku}` };
    // Both endpoints reject a repeated item on one order (receiving and
    // picking both resolve a line by (order, item) and would pick the
    // wrong one), so catch it here where we can name the SKU.
    if (seen.has(itemId)) return { error: `Duplicate SKU on this order: ${sku}` };
    seen.add(itemId);
    lines.push({ item_id: itemId, quantity_ordered: Number(entries[i].quantity_ordered) });
  }
  return { lines };
}
