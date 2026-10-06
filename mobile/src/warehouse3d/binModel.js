/**
 * Bin helpers for the mobile 3D warehouse view.
 *
 * Copied from admin/src/pages/simulation/binModel.js (the web 2D / 3D
 * simulation) so the handheld classifies and searches bins exactly the
 * way the admin panel does. The apps do not import across each other,
 * so keep this file identical to the admin copy when either changes.
 * Left out: apiErrorMessage / normalizeLotNumber (admin-only helpers).
 * Pure: no React, no API.
 */

export function binSlotStatus(bin) {
  if (!bin || Number(bin.total_qty || 0) <= 0) return 'empty';
  const nearExpiry = (bin.pallets || []).some((p) => {
    if (!p.expiry_date) return false;
    const d = Math.ceil((new Date(p.expiry_date).getTime() - Date.now()) / (86400000));
    return d <= 30;
  });
  return nearExpiry ? 'expired' : 'occupied';
}

/** Pallets with LPN, empty LPNs, and bin-level inventory without pallet. */
export function binStockView(bin) {
  const allPallets = (bin?.pallets || []).filter((p) => !p.is_synthetic);
  const unpalletized = (bin?.contents || []).filter(
    (c) => (c.pallet_id == null || c.pallet_id === '') && Number(c.quantity_on_hand || 0) > 0,
  );
  const pallets = allPallets.filter((p) => Number(p.quantity_on_hand || 0) > 0);
  const emptyPallets = allPallets.filter(
    (p) => Number(p.quantity_on_hand || 0) <= 0 || p.is_empty,
  );
  return { pallets, emptyPallets, unpalletized, allPallets };
}

/**
 * Bins (and the pallets inside them) matching a SKU / item name / lot /
 * pallet / bin-code query. One location per matching pallet, or one per
 * bin when the match is on the bin itself or its loose stock.
 */
export function matchingLocations(bins, queryValue) {
  const query = String(queryValue || '').trim().toLowerCase();
  if (!query) return [];
  return (bins || []).flatMap((bin) => {
    const binMatch = String(bin.bin_code || '').toLowerCase().includes(query);
    const realPallets = (bin.pallets || []).filter((p) => !p.is_synthetic);
    const pallets = realPallets.filter((pallet) => (
      [pallet.sku, pallet.lot_code, pallet.pallet_id, pallet.pallet_code, pallet.item_name].some((value) => (
        String(value || '').toLowerCase().includes(query)
      ))
    ));
    const contentMatch = (bin.contents || []).some((content) => (
      [content.sku, content.item_name, content.lot_number].some((value) => (
        String(value || '').toLowerCase().includes(query)
      ))
    ));
    if (!binMatch && !contentMatch && pallets.length === 0) return [];
    const location = {
      bin_id: bin.bin_id,
      bin_code: bin.bin_code,
      zone_id: bin.zone_id,
      rack_id: bin.rack_id,
      rack_key: bin.rack_key,
      level: Number(bin.level ?? bin.level_num ?? 1) || 1,
    };
    if (pallets.length) {
      return pallets.map((pallet) => ({ ...location, pallet_id: pallet.pallet_id }));
    }
    return [{ ...location, pallet_id: null }];
  });
}
