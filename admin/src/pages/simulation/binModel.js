/**
 * Bin helpers shared by the 2D warehouse simulation and the 3D view.
 *
 * Moved out of WarehouseSimulation.jsx unchanged so both pages classify,
 * split and search bins the same way. Pure: no React, no API.
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

export function apiErrorMessage(data, fallback) {
  if (data?.error === 'Permission denied') {
    return 'Không đủ quyền thao tác. Cần quyền Simulation hoặc trang tương ứng.';
  }
  if (data?.error === 'validation_error' && Array.isArray(data.details)) {
    return data.details.map((d) => d.msg || d.type).join('; ');
  }
  if (data?.error === 'integrity_constraint_violation') {
    return 'Dữ liệu xung đột — thử tải lại hoặc chọn pallet khác.';
  }
  return data?.error || data?.message || fallback;
}

export function normalizeLotNumber(lot) {
  if (lot == null) return null;
  const value = String(lot).trim();
  return value || null;
}
