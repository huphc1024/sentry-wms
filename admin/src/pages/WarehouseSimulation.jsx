import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import { useLocale } from '../i18n/locale.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import SkuBarcodeAutocomplete from '../components/SkuBarcodeAutocomplete.jsx';
import { resolveItemFromScan } from '../utils/itemScanOptions.js';
import { t as tr } from '../i18n/translate.js';

const ZONE_TYPES = ['RECEIVING', 'STORAGE', 'PICKING', 'STAGING', 'SHIPPING'];

function defaultBinTypeForZone(zone) {
  const type = zone?.zone_type || 'STORAGE';
  return type === 'RECEIVING' || type === 'STAGING' ? 'Staging' : 'Pickable';
}

function buildBinCode({ zoneCode, aisle, bay, level, position }) {
  const prefix = (zoneCode || 'BIN').toUpperCase();
  const a = (aisle || 'X').toUpperCase();
  const bayStr = String(bay).padStart(3, '0');
  return `${prefix}-${a}-${bayStr}-L${level}-P${position}`;
}

function rackAddressFromContext(rack, bins, zone) {
  const rackBins = binsForRack(rack, bins);
  const first = rackBins[0];
  if (first) {
    return {
      zone_id: first.zone_id,
      zone_code: first.zone_code || zone?.zone_code,
      aisle: first.aisle || null,
      bay: first.bay ?? first.row_num ?? null,
    };
  }
  const parts = String(rack?.rack_key || '').split('|');
  return {
    zone_id: rack?.zone_id ?? zone?.zone_id ?? (parts[0] ? Number(parts[0]) : null),
    zone_code: rack?.zone_code || zone?.zone_code,
    aisle: parts[1] && parts[1] !== 'X' ? parts[1] : null,
    bay: parts[2] || null,
  };
}

function nextBayInZone(zoneId, bins) {
  const nums = (bins || [])
    .filter((b) => b.zone_id === zoneId && b.row_num != null && /^\d+$/.test(String(b.row_num)))
    .map((b) => Number(b.row_num));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function nextLevelInRack(rack, bins) {
  const levels = binsForRack(rack, bins).map((b) => Number(b.level ?? b.level_num ?? 1) || 1);
  return levels.length ? Math.max(...levels) + 1 : 1;
}

function nextPositionOnLevel(rack, level, bins) {
  const positions = binsForRack(rack, bins)
    .filter((b) => (Number(b.level ?? b.level_num ?? 1) || 1) === level)
    .map((b) => Number(b.position ?? b.position_num ?? 1) || 1);
  return positions.length ? Math.max(...positions) + 1 : 1;
}

function buildBinPayload({
  zoneId, zoneCode, aisle, bay, level, position, binType,
}) {
  const binCode = buildBinCode({ zoneCode, aisle, bay, level, position });
  const bayNum = /^\d+$/.test(String(bay)) ? Number(bay) : null;
  return {
    zone_id: zoneId,
    bin_code: binCode,
    bin_barcode: binCode,
    bin_type: binType,
    aisle: aisle || null,
    row_num: bayNum,
    level_num: level,
    position_num: position,
  };
}

async function postBinsBatch(warehouseId, payloads) {
  for (const body of payloads) {
    const res = await api.post('/admin/bins', { ...body, warehouse_id: warehouseId }, { silentPermissionDenied: true });
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      if (data?.error === 'Permission denied') {
        throw new Error(tr('warehouseSimulation.noBinPermission'));
      }
      throw new Error(data?.error || tr('warehouseSimulation.binCreateFailed', {
        code: body.bin_code,
      }));
    }
  }
}

function zoneForContext(selectedZone, selectedZoneId, zones) {
  return selectedZone || zones.find((z) => z.zone_id === selectedZoneId) || null;
}

function apiErrorMessage(data, fallback) {
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

function normalizeLotNumber(lot) {
  if (lot == null) return null;
  const value = String(lot).trim();
  return value || null;
}

function printSlip(type, pallet, bin) {
  // Printed and handed to the floor. The two titles here were
  // unaccented Vietnamese -- `Phieu nhap pallet`, `Ton` -- which is
  // what gets typed when a file has no place to put a translation.
  const title = tr(type === 'inbound'
    ? 'warehouseSimulation.slipInbound'
    : 'warehouseSimulation.slipOutbound');
  const w = window.open('', '_blank', 'width=760,height=640');
  if (!w) return;
  const html = `<html><head><title>${title}</title></head><body style="font-family:Arial,sans-serif;padding:20px"><h2>${title}</h2>
    <table style="border-collapse:collapse;width:100%">
      <tr><td style="border:1px solid #ccc;padding:6px">${tr('warehouseSimulation.palletId')}</td><td style="border:1px solid #ccc;padding:6px">${pallet.pallet_id}</td></tr>
      <tr><td style="border:1px solid #ccc;padding:6px">${tr('common.sku')}</td><td style="border:1px solid #ccc;padding:6px">${pallet.sku}</td></tr>
      <tr><td style="border:1px solid #ccc;padding:6px">${tr('warehouseSimulation.lot')}</td><td style="border:1px solid #ccc;padding:6px">${pallet.lot_code || '-'}</td></tr>
      <tr><td style="border:1px solid #ccc;padding:6px">${tr('common.onHand')}</td><td style="border:1px solid #ccc;padding:6px">${pallet.quantity_on_hand}</td></tr>
      <tr><td style="border:1px solid #ccc;padding:6px">${tr('common.bin')}</td><td style="border:1px solid #ccc;padding:6px">${bin?.bin_code || '-'}</td></tr>
    </table></body></html>`;
  w.document.open(); w.document.write(html); w.document.close(); w.focus(); w.print();
}

function binSlotStatus(bin) {
  if (!bin || Number(bin.total_qty || 0) <= 0) return 'empty';
  const nearExpiry = (bin.pallets || []).some((p) => {
    if (!p.expiry_date) return false;
    const d = Math.ceil((new Date(p.expiry_date).getTime() - Date.now()) / (86400000));
    return d <= 30;
  });
  return nearExpiry ? 'expired' : 'occupied';
}

/** Pallets with LPN, empty LPNs, and bin-level inventory without pallet. */
function binStockView(bin) {
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

function binsForRack(rack, bins) {
  if (!rack) return [];
  return (bins || []).filter((b) => (
    (rack.rack_id != null && b.rack_id === rack.rack_id)
    || (rack.rack_key && b.rack_key === rack.rack_key)
  ));
}

/** Backend fallback "?-REC" → "Kệ REC" when bin has no aisle. */
function formatRackLabel(rack, bins = []) {
  const rackBins = binsForRack(rack, bins);
  const raw = String(rack?.rack_label || rack?.label || '').trim();
  if (raw && !/^\?-/.test(raw) && raw !== '?-???') return raw;

  const bad = raw.match(/^\?-(.+)$/);
  if (bad) {
    const suffix = bad[1];
    return /^\d+$/.test(suffix) ? `Kệ ${parseInt(suffix, 10)}` : `Kệ ${suffix}`;
  }

  const parts = String(rack?.rack_key || '').split('|');
  if (parts.length >= 3) {
    const aisle = parts[1];
    const bay = parts[2];
    if (aisle && aisle !== 'X' && aisle !== '?') {
      const bayPart = /^\d+$/.test(bay) ? String(bay).padStart(3, '0') : bay;
      return `${aisle}-${bayPart}`;
    }
    if (bay && bay !== 'X' && bay !== '?') {
      if (/^\d+$/.test(bay)) return `Kệ ${parseInt(bay, 10)}`;
      if (bay.includes('-')) return `Kệ ${bay.split('-')[0]}`;
      return `Kệ ${bay}`;
    }
  }

  const named = rackBins.find((b) => b.rack_label && !/^\?-/.test(b.rack_label));
  if (named?.rack_label) return named.rack_label;

  const first = rackBins[0];
  if (first?.bin_code) {
    const head = first.bin_code.split('-')[0];
    return head ? `Kệ ${head}` : first.bin_code.slice(0, 16);
  }

  const zone = rack?.zone_name || rack?.zone_code;
  return zone ? `Kệ (${zone})` : 'Kệ';
}

function racksInZone(zoneId, racks, bins) {
  const inZone = (racks || []).filter((r) => r.zone_id === zoneId);
  if (inZone.length) {
    return inZone
      .map((rack) => ({ ...rack, display_label: formatRackLabel(rack, bins) }))
      .sort((a, b) => String(a.display_label).localeCompare(String(b.display_label)));
  }
  const byKey = new Map();
  (bins || []).filter((b) => b.zone_id === zoneId).forEach((bin) => {
    const key = bin.rack_key || `${zoneId}|${bin.bin_code}`;
    if (byKey.has(key)) return;
    byKey.set(key, {
      rack_key: key,
      rack_id: bin.rack_id,
      rack_label: bin.rack_label || key,
      zone_id: zoneId,
      total_slots: 0,
      occupied_slots: 0,
    });
  });
  const grouped = [...byKey.values()];
  grouped.forEach((rack) => {
    const rackBins = binsForRack(rack, bins);
    rack.total_slots = rackBins.length;
    rack.occupied_slots = rackBins.filter((b) => Number(b.total_qty || 0) > 0).length;
    rack.display_label = formatRackLabel(rack, bins);
  });
  return grouped.sort((a, b) => String(a.display_label).localeCompare(String(b.display_label)));
}

function buildRackLevels(rackKey, rackId, bins) {
  const rackBins = (bins || []).filter((b) => (
    (rackId != null && b.rack_id === rackId)
    || (rackKey && b.rack_key === rackKey)
  ));
  if (!rackBins.length) return [];
  const levelsMap = new Map();
  rackBins.forEach((bin) => {
    const lvl = Number(bin.level ?? bin.level_num ?? 1) || 1;
    if (!levelsMap.has(lvl)) levelsMap.set(lvl, []);
    levelsMap.get(lvl).push(bin);
  });
  return [...levelsMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([level, levelBins]) => ({
      level,
      bins: levelBins.sort((a, b) => (
        (Number(a.position ?? a.position_num ?? 1) || 1)
        - (Number(b.position ?? b.position_num ?? 1) || 1)
      )),
      occupied: levelBins.filter((b) => Number(b.total_qty || 0) > 0).length,
      total: levelBins.length,
    }));
}

export default function WarehouseSimulation() {
  const { warehouseId, warehouse } = useWarehouse();
  const { t } = useLocale();
  const [mapData, setMapData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedZoneId, setSelectedZoneId] = useState(null);
  const [selectedRackKey, setSelectedRackKey] = useState(null);
  const [selectedRackId, setSelectedRackId] = useState(null);
  const [selectedLevel, setSelectedLevel] = useState(null);
  const [selectedBin, setSelectedBin] = useState(null);
  const [selectedPallet, setSelectedPallet] = useState(null);
  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [skuQuery, setSkuQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [moveQty, setMoveQty] = useState('1');
  const [moveMsg, setMoveMsg] = useState('');
  const [moveError, setMoveError] = useState('');
  const [moveBusy, setMoveBusy] = useState(false);
  const skuInputRef = useRef(null);
  const [addModal, setAddModal] = useState(null);
  const [addForm, setAddForm] = useState({});
  const [addError, setAddError] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachRow, setAttachRow] = useState(null);
  const [attachForm, setAttachForm] = useState({});
  const [attachError, setAttachError] = useState('');
  const [attachBusy, setAttachBusy] = useState(false);
  const [moveLot, setMoveLot] = useState(null);

  const bins = useMemo(() => mapData?.bins || [], [mapData]);
  const zones = useMemo(() => mapData?.zones || [], [mapData]);
  const racks = useMemo(() => mapData?.racks || [], [mapData]);

  const loadMap = useCallback(async () => {
    if (!warehouseId) return;
    setLoading(true);
    setError('');
    const res = await api.get(`/admin/warehouse-map?warehouse_id=${warehouseId}`);
    setLoading(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setError(data?.error || t('warehouseSimulation.loadError'));
      return;
    }
    setMapData(await res.json());
  }, [warehouseId, t]);

  useEffect(() => { loadMap(); }, [loadMap]);

  const selected = useMemo(
    () => bins.find((b) => b.bin_id === selectedBin) || null,
    [bins, selectedBin],
  );
  const selectedPalletData = useMemo(() => {
    if (!selected || !selectedPallet) return null;
    return (selected.pallets || []).find((p) => p.pallet_id === selectedPallet) || null;
  }, [selected, selectedPallet]);

  const selectedZone = zones.find((z) => z.zone_id === selectedZoneId);
  const zoneRacks = useMemo(
    () => (selectedZoneId != null ? racksInZone(selectedZoneId, racks, bins) : []),
    [selectedZoneId, racks, bins],
  );
  const selectedRack = zoneRacks.find((r) => (
    r.rack_key === selectedRackKey
    || (selectedRackId != null && r.rack_id === selectedRackId)
  )) || racks.find((r) => (
    r.rack_key === selectedRackKey
    || (selectedRackId != null && r.rack_id === selectedRackId)
  ));
  const rackLevels = useMemo(
    () => buildRackLevels(selectedRackKey, selectedRackId, bins),
    [selectedRackKey, selectedRackId, bins],
  );
  const currentLevel = rackLevels.find((l) => l.level === selectedLevel);

  const totalSlots = zones.reduce((sum, z) => sum + (z.bin_count || 0), 0) || bins.length;
  const occupiedSlots = zones.reduce((sum, z) => sum + (z.occupied_bins || 0), 0)
    || bins.filter((b) => Number(b.total_qty || 0) > 0).length;
  const occupancyPercent = totalSlots ? Math.round((occupiedSlots / totalSlots) * 100) : 0;

  const skuOptions = useMemo(() => {
    const options = new Map();
    bins.forEach((bin) => {
      (bin.contents || []).forEach((content) => {
        if (content.sku && !options.has(content.sku)) {
          options.set(content.sku, { sku: content.sku, item_name: content.item_name || '' });
        }
      });
    });
    return [...options.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  }, [bins]);

  const buildMatchingLocations = useCallback((queryValue) => {
    const query = String(queryValue || '').trim().toLowerCase();
    if (!query) return [];
    return bins.flatMap((bin) => {
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
  }, [bins]);

  const clearNav = () => {
    setSelectedZoneId(null);
    setSelectedRackKey(null);
    setSelectedRackId(null);
    setSelectedLevel(null);
    setSelectedBin(null);
    setSelectedPallet(null);
  };

  const openZone = (zoneId) => {
    setSelectedZoneId(zoneId);
    setSelectedRackKey(null);
    setSelectedRackId(null);
    setSelectedLevel(null);
    setSelectedBin(null);
    setSelectedPallet(null);
  };

  const openRack = (rack) => {
    setSelectedRackKey(rack.rack_key);
    setSelectedRackId(rack.rack_id ?? null);
    setSelectedZoneId(rack.zone_id ?? selectedZoneId);
    setSelectedLevel(null);
    setSelectedBin(null);
    setSelectedPallet(null);
  };

  const openLevel = (level) => {
    setSelectedLevel(level);
    setSelectedBin(null);
    setSelectedPallet(null);
  };

  const selectBin = (binId, palletId = null) => {
    const bin = bins.find((b) => b.bin_id === binId);
    setSelectedBin(binId);
    setSelectedZoneId(bin?.zone_id ?? selectedZoneId);
    setSelectedRackKey(bin?.rack_key ?? selectedRackKey);
    setSelectedRackId(bin?.rack_id ?? selectedRackId);
    setSelectedLevel(Number(bin?.level ?? bin?.level_num ?? selectedLevel) || selectedLevel);
    setSelectedPallet(palletId);
  };

  const openBinSlot = (binId, palletId = null, lotNumber = null) => {
    selectBin(binId, palletId);
    setSkuQuery('');
    setSelectedItem(null);
    setMoveQty('1');
    setMoveLot(lotNumber);
    setMoveMsg('');
    setMoveError('');
    setSlotModalOpen(true);
    setTimeout(() => skuInputRef.current?.focus(), 80);
  };

  const selectSearchLocation = (location) => {
    setSelectedZoneId(location.zone_id ?? null);
    setSelectedRackKey(location.rack_key ?? null);
    setSelectedRackId(location.rack_id ?? null);
    setSelectedLevel(location.level ?? null);
    setSelectedBin(location.bin_id);
    setSelectedPallet(location.pallet_id ?? null);
  };

  const applySearchQuery = (value) => {
    const query = String(value || '').trim();
    setSearch(query);
    if (!query) return;
    const first = buildMatchingLocations(query)[0];
    if (first) selectSearchLocation(first);
  };

  const resolveMoveItem = useCallback(async (q) => {
    const trimmed = String(q || '').trim();
    if (!trimmed) return null;
    if (selectedItem) {
      const fromSelected = resolveItemFromScan(trimmed, [selectedItem]);
      if (fromSelected) return fromSelected;
    }
    const exact = await api.get(`/lookup/item/${encodeURIComponent(trimmed)}`, { silentPermissionDenied: true });
    if (exact?.ok) {
      const item = await exact.json();
      if (item?.item_id) return item;
    }
    const res = await api.get(`/lookup/item/search?q=${encodeURIComponent(trimmed)}`, { silentPermissionDenied: true });
    if (res?.ok) {
      const list = await res.json();
      const items = Array.isArray(list) ? list : [];
      const hit = resolveItemFromScan(trimmed, items) || items[0];
      if (hit) return hit;
    }
    const adminRes = await api.get(
      `/admin/items?q=${encodeURIComponent(trimmed)}&per_page=12&active=true`,
      { silentPermissionDenied: true },
    );
    if (!adminRes?.ok) return null;
    const data = await adminRes.json();
    const list = data.items || [];
    return resolveItemFromScan(trimmed, list) || list[0] || null;
  }, [selectedItem]);

  const submitMove = async (adjustmentType) => {
    if (!selected || !warehouseId) return;
    let itemId = selectedItem?.item_id;
    if (!itemId && skuQuery.trim()) {
      const resolved = await resolveMoveItem(skuQuery.trim());
      itemId = resolved?.item_id;
      if (resolved) setSelectedItem(resolved);
    }
    if (!itemId) {
      setMoveError('Chọn hoặc scan SKU trước.');
      return;
    }
    const qty = parseInt(moveQty, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      setMoveError('Số lượng phải > 0.');
      return;
    }
    setMoveBusy(true);
    setMoveError('');
    setMoveMsg('');
    const res = await api.post('/admin/adjustments/direct', {
      warehouse_id: Number(warehouseId),
      bin_id: selected.bin_id,
      item_id: itemId,
      adjustment_type: adjustmentType,
      quantity: qty,
      // Stored on the adjustment row and read back by the audit trail,
      // so it stays one language regardless of who made it.
      reason: /* i18n-ignore */ `Simulation ${adjustmentType === 'ADD' ? 'inbound' : 'outbound'} ${selected.bin_code}`,
      pallet_id: selectedPallet || undefined,
      lot_number: moveLot || undefined,
    }, { silentPermissionDenied: true });
    setMoveBusy(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setMoveError(apiErrorMessage(data, 'Thao tác thất bại.'));
      return;
    }
    setMoveMsg(t(adjustmentType === 'ADD'
      ? 'warehouseSimulation.movedIn'
      : 'warehouseSimulation.movedOut', { qty, bin: selected.bin_code }));
    await loadMap();
  };

  const closeAddModal = () => {
    setAddModal(null);
    setAddForm({});
    setAddError('');
  };

  const openAddZone = () => {
    setAddForm({ zone_type: 'STORAGE' });
    setAddError('');
    setAddModal('zone');
  };

  const openAddRack = () => {
    if (!selectedZone) return;
    const bay = nextBayInZone(selectedZone.zone_id, bins);
    setAddForm({
      aisle: '',
      bay: String(bay),
      levels: '4',
      positions: '1',
      bin_type: defaultBinTypeForZone(selectedZone),
    });
    setAddError('');
    setAddModal('rack');
  };

  const openAddLevel = () => {
    if (!selectedRack) return;
    const level = nextLevelInRack(selectedRack, bins);
    const addr = rackAddressFromContext(selectedRack, bins, selectedZone);
    const perLevel = new Map();
    binsForRack(selectedRack, bins).forEach((b) => {
      const lvl = Number(b.level ?? b.level_num ?? 1) || 1;
      perLevel.set(lvl, (perLevel.get(lvl) || 0) + 1);
    });
    const positions = perLevel.size ? Math.max(...perLevel.values()) : 1;
    setAddForm({
      level: String(level),
      positions: String(positions),
      bin_type: defaultBinTypeForZone(selectedZone),
      aisle: addr.aisle || '',
      bay: String(addr.bay ?? ''),
    });
    setAddError('');
    setAddModal('level');
  };

  const openAddSlot = () => {
    if (!selectedRack || selectedLevel == null) return;
    const addr = rackAddressFromContext(selectedRack, bins, selectedZone);
    const position = nextPositionOnLevel(selectedRack, selectedLevel, bins);
    setAddForm({
      level: String(selectedLevel),
      position: String(position),
      bin_type: defaultBinTypeForZone(selectedZone),
      aisle: addr.aisle || '',
      bay: String(addr.bay ?? ''),
    });
    setAddError('');
    setAddModal('slot');
  };

  const openAddPallet = async () => {
    if (!selected || !warehouseId) return;
    setAddError('');
    setAddForm({ bin_id: selected.bin_id, quantity: '0', lot_code: '', expiry_date: '' });
    setAddModal('pallet');
    const res = await api.get(`/admin/pallets/next-code?warehouse_id=${warehouseId}`, { silentPermissionDenied: true });
    if (res?.ok) {
      const data = await res.json();
      setAddForm((f) => ({
        ...f,
        pallet_code: data.pallet_code,
        pallet_barcode: data.pallet_code,
      }));
    }
  };

  const submitAddZone = async () => {
    if (!warehouseId) return;
    setAddBusy(true);
    setAddError('');
    const res = await api.post('/admin/zones', {
      warehouse_id: Number(warehouseId),
      zone_code: String(addForm.zone_code || '').trim(),
      zone_name: String(addForm.zone_name || '').trim(),
      zone_type: addForm.zone_type || 'STORAGE',
    });
    setAddBusy(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setAddError(data?.error || 'Không tạo được khu.');
      return;
    }
    const created = await res.json();
    closeAddModal();
    await loadMap();
    openZone(created.zone_id);
  };

  const submitAddRack = async () => {
    if (!warehouseId || !selectedZone) return;
    const bay = String(addForm.bay || '').trim();
    if (!bay) {
      setAddError('Nhập số kệ (bay).');
      return;
    }
    const levels = Math.max(1, parseInt(addForm.levels, 10) || 1);
    const positions = Math.max(1, parseInt(addForm.positions, 10) || 1);
    const aisle = String(addForm.aisle || '').trim() || null;
    const binType = addForm.bin_type || defaultBinTypeForZone(selectedZone);
    const payloads = [];
    for (let level = 1; level <= levels; level += 1) {
      for (let position = 1; position <= positions; position += 1) {
        payloads.push(buildBinPayload({
          zoneId: selectedZone.zone_id,
          zoneCode: selectedZone.zone_code,
          aisle,
          bay,
          level,
          position,
          binType,
        }));
      }
    }
    setAddBusy(true);
    setAddError('');
    try {
      await postBinsBatch(warehouseId, payloads);
      closeAddModal();
      await loadMap();
      const rackKey = `${selectedZone.zone_id}|${aisle || 'X'}|${bay}`;
      openZone(selectedZone.zone_id);
      openRack({ rack_key: rackKey, zone_id: selectedZone.zone_id });
    } catch (err) {
      setAddError(err.message || 'Không tạo được kệ.');
    } finally {
      setAddBusy(false);
    }
  };

  const submitAddLevel = async () => {
    if (!warehouseId || !selectedZone || !selectedRack) return;
    const level = parseInt(addForm.level, 10);
    const positions = Math.max(1, parseInt(addForm.positions, 10) || 1);
    const bay = String(addForm.bay || '').trim();
    if (!Number.isFinite(level) || level <= 0 || !bay) {
      setAddError('Nhập số tầng và số kệ.');
      return;
    }
    const aisle = String(addForm.aisle || '').trim() || null;
    const binType = addForm.bin_type || defaultBinTypeForZone(selectedZone);
    const payloads = [];
    for (let position = 1; position <= positions; position += 1) {
      payloads.push(buildBinPayload({
        zoneId: selectedZone.zone_id,
        zoneCode: selectedZone.zone_code,
        aisle,
        bay,
        level,
        position,
        binType,
      }));
    }
    setAddBusy(true);
    setAddError('');
    try {
      await postBinsBatch(warehouseId, payloads);
      closeAddModal();
      await loadMap();
      openRack(selectedRack);
      openLevel(level);
    } catch (err) {
      setAddError(err.message || 'Không tạo được tầng.');
    } finally {
      setAddBusy(false);
    }
  };

  const submitAddSlot = async () => {
    const zone = zoneForContext(selectedZone, selectedZoneId, zones);
    if (!warehouseId || !zone || !selectedRack) {
      setAddError('Chọn khu và kệ trước khi thêm ô.');
      return;
    }
    const level = parseInt(addForm.level, 10);
    const position = parseInt(addForm.position, 10);
    let bay = String(addForm.bay || '').trim();
    if (!bay) {
      const addr = rackAddressFromContext(selectedRack, bins, zone);
      bay = String(addr.bay || '').trim();
    }
    if (!Number.isFinite(level) || !Number.isFinite(position) || !bay) {
      setAddError('Nhập đủ thông tin ô (tầng, vị trí, số kệ).');
      return;
    }
    const aisle = String(addForm.aisle || '').trim() || null;
    const binType = addForm.bin_type || defaultBinTypeForZone(zone);
    setAddBusy(true);
    setAddError('');
    try {
      await postBinsBatch(warehouseId, [buildBinPayload({
        zoneId: zone.zone_id,
        zoneCode: zone.zone_code,
        aisle,
        bay,
        level,
        position,
        binType,
      })]);
      closeAddModal();
      await loadMap();
      openRack(selectedRack);
      openLevel(level);
    } catch (err) {
      setAddError(err.message || 'Không tạo được ô.');
    } finally {
      setAddBusy(false);
    }
  };

  const submitAddPallet = async () => {
    if (!warehouseId || !selected) return;
    setAddBusy(true);
    setAddError('');
    const body = {
      warehouse_id: Number(warehouseId),
      bin_id: selected.bin_id,
      pallet_code: addForm.pallet_code || undefined,
      pallet_barcode: addForm.pallet_barcode || addForm.pallet_code || undefined,
      quantity: Number(addForm.quantity) || 0,
      lot_code: addForm.lot_code || null,
      expiry_date: addForm.expiry_date || null,
    };
    if (addForm.item_id) body.item_id = Number(addForm.item_id);
    const res = await api.post('/admin/pallets', body, { silentPermissionDenied: true });
    setAddBusy(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setAddError(apiErrorMessage(data, 'Không tạo được pallet.'));
      return;
    }
    const created = await res.json();
    closeAddModal();
    await loadMap();
    selectBin(selected.bin_id, created.pallet_id);
  };

  const openAttachPallet = (row) => {
    if (!selected) return;
    const stock = binStockView(selected);
    const defaultPallet = stock.emptyPallets[0]?.pallet_id;
    setAttachRow(row);
    setAttachForm({
      pallet_id: defaultPallet ? String(defaultPallet) : 'new',
      quantity: String(row.quantity_on_hand || ''),
    });
    setAttachError('');
    setAttachOpen(true);
  };

  const submitAttachPallet = async () => {
    if (!selected || !attachRow || !warehouseId) return;
    if (!attachRow.item_id) {
      setAttachError('Thiếu thông tin SKU — tải lại bản đồ kho.');
      return;
    }
    setAttachBusy(true);
    setAttachError('');
    try {
      let palletId = attachForm.pallet_id === 'new'
        ? null
        : Number(attachForm.pallet_id);
      if (!Number.isFinite(palletId)) {
        const createRes = await api.post('/admin/pallets', {
          warehouse_id: Number(warehouseId),
          bin_id: Number(selected.bin_id),
          quantity: 0,
        }, { silentPermissionDenied: true });
        if (!createRes?.ok) {
          const data = await createRes?.json().catch(() => ({}));
          throw new Error(apiErrorMessage(data, 'Không tạo được pallet.'));
        }
        const created = await createRes.json();
        palletId = created.pallet_id;
      }
      const qtyRaw = attachForm.quantity !== '' && attachForm.quantity != null
        ? parseInt(String(attachForm.quantity), 10)
        : undefined;
      const body = {
        item_id: Number(attachRow.item_id),
        bin_id: Number(selected.bin_id),
        lot_number: normalizeLotNumber(attachRow.lot_number),
      };
      if (Number.isFinite(qtyRaw) && qtyRaw > 0) body.quantity = qtyRaw;
      const res = await api.post(`/admin/pallets/${palletId}/attach-inventory`, body, { silentPermissionDenied: true });
      if (!res?.ok) {
        const data = await res?.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, 'Không gắn được pallet.'));
      }
      setAttachOpen(false);
      setAttachRow(null);
      await loadMap();
      selectBin(selected.bin_id, palletId);
    } catch (err) {
      setAttachError(err.message || 'Không gắn được pallet.');
    } finally {
      setAttachBusy(false);
    }
  };

  const warehouseTitle = warehouse?.warehouse_name
    || mapData?.warehouse_name
    || mapData?.warehouse_code
    || 'Mô phỏng kho';

  const navStep = !selectedZoneId ? 0 : !selectedRackKey ? 1 : selectedLevel == null ? 2 : 3;

  return (
    <div className="warehouse-simulation-page">
      <PageHeader title={warehouseTitle}>
        <button type="button" className="btn btn-sm" onClick={loadMap} disabled={loading}>
          {loading ? t('warehouseSimulation.loading') : t('warehouseSimulation.refresh')}
        </button>
      </PageHeader>

      {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
      {!warehouseId && <p style={{ color: 'var(--text-secondary)' }}>{t('warehouseSimulation.selectWarehouse')}</p>}

      {mapData && (
        <>
          <div className="sim2-legend-bar" aria-label={t('warehouseSimulation.legend')}>
            <div className="sim2-legend-bar-group">
              <span className="sim2-legend-item sim2-legend-status sim2-legend-status--empty"><span className="sim2-dot empty" /> {t('warehouseSimulation.statusEmpty')}</span>
              <span className="sim2-legend-item sim2-legend-status sim2-legend-status--occupied"><span className="sim2-dot occupied" /> {t('warehouseSimulation.statusOccupied')}</span>
              <span className="sim2-legend-item sim2-legend-status sim2-legend-status--expired"><span className="sim2-dot expired" /> {t('warehouseSimulation.statusExpiring')}</span>
            </div>
            <span className="sim2-context-note">{t('warehouseSimulation.clickPath')}</span>
          </div>

          <div className="sim-simple-toolbar">
            <input
              className="form-input sim2-search-input"
              list="warehouse-sku-options"
              aria-label={t('warehouseSimulation.searchLabel')}
              placeholder={t('warehouseSimulation.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applySearchQuery(e.target.value); }}
            />
            <datalist id="warehouse-sku-options">
              {skuOptions.map((option) => (
                <option key={option.sku} value={option.sku}>{option.item_name}</option>
              ))}
            </datalist>
          </div>

          <div className="sim2-metric-grid" style={{ marginBottom: 16 }}>
            <div className="sim2-metric"><span>{t('warehouseSimulation.occupancy')}</span><strong>{occupancyPercent}%</strong></div>
            <div className="sim2-metric"><span>{t('warehouseSimulation.binsWithStock')}</span><strong>{occupiedSlots}/{totalSlots}</strong></div>
            <div className="sim2-metric"><span>{t('warehouseSimulation.zone')}</span><strong>{zones.length}</strong></div>
          </div>

          <nav className="sim2-breadcrumb" aria-label={t('warehouseSimulation.breadcrumb')}>
            <button type="button" className={navStep === 0 ? 'is-active' : ''} onClick={clearNav}>{t('common.warehouse')}</button>
            {selectedZone && (
              <>
                <span>/</span>
                <button
                  type="button"
                  className={navStep === 1 ? 'is-active' : ''}
                  onClick={() => openZone(selectedZone.zone_id)}
                >
                  {selectedZone.zone_name || selectedZone.zone_code}
                </button>
              </>
            )}
            {selectedRack && (
              <>
                <span>/</span>
                <button
                  type="button"
                  className={navStep === 2 ? 'is-active' : ''}
                  onClick={() => openRack(selectedRack)}
                >
                  {formatRackLabel(selectedRack, bins)}
                </button>
              </>
            )}
            {selectedLevel != null && (
              <>
                <span>/</span>
                <button
                  type="button"
                  className={navStep === 3 ? 'is-active' : ''}
                  onClick={() => openLevel(selectedLevel)}
                >
                  {t('warehouseSimulation.levelN', { level: selectedLevel })}
                </button>
              </>
            )}
          </nav>

          <div className="sim-simple-panel">
            {navStep === 0 && (
              <>
                <div className="sim-simple-panel-head">
                  <h3 className="sim-simple-title">{t('warehouseSimulation.pickZone')}</h3>
                  <button type="button" className="btn btn-sm btn-primary" onClick={openAddZone}>{t('warehouseSimulation.addZone')}</button>
                </div>
                <div className="sim2-block-grid">
                  {zones.map((zone) => {
                    const fill = zone.fill_pct ?? 0;
                    return (
                      <button
                        key={zone.zone_id}
                        type="button"
                        className="sim2-block-card"
                        onClick={() => openZone(zone.zone_id)}
                      >
                        <strong>{zone.zone_name || zone.zone_code}</strong>
                        <span>{zone.zone_code}</span>
                        <span>
                          {t('warehouseSimulation.zoneCounts', {
                            occupied: zone.occupied_bins ?? 0,
                            bins: zone.bin_count ?? 0,
                            racks: zone.rack_count ?? 0,
                          })}
                        </span>
                        <div className="sim2-block-meter" style={{ '--fill': `${fill}%` }} aria-hidden />
                        <span>{t('warehouseSimulation.percentFull', { percent: fill })}</span>
                      </button>
                    );
                  })}
                  {!zones.length && <div className="sim2-empty-hint">{t('warehouseSimulation.noZones')}</div>}
                </div>
              </>
            )}

            {navStep === 1 && (
              <>
                <div className="sim-simple-panel-head">
                  <h3 className="sim-simple-title">
                    {t('warehouseSimulation.racksIn', { zone: selectedZone?.zone_name })}
                  </h3>
                  <button type="button" className="btn btn-sm btn-primary" onClick={openAddRack}>{t('warehouseSimulation.addRack')}</button>
                </div>
                <div className="sim2-block-grid">
                  {zoneRacks.map((rack) => (
                    <button
                      key={rack.rack_key}
                      type="button"
                      className="sim2-block-card"
                      onClick={() => openRack(rack)}
                    >
                      <strong>{rack.display_label || formatRackLabel(rack, bins)}</strong>
                      <span>
                        {t('warehouseSimulation.rackCounts', {
                          occupied: rack.occupied_slots ?? 0,
                          total: rack.total_slots ?? 0,
                        })}
                      </span>
                    </button>
                  ))}
                  {!zoneRacks.length && (
                    <div className="sim2-empty-hint">{t('warehouseSimulation.noRacks')}</div>
                  )}
                </div>
              </>
            )}

            {navStep === 2 && (
              <>
                <div className="sim-simple-panel-head">
                  <h3 className="sim-simple-title">
                    {t('warehouseSimulation.pickLevel', {
                      rack: formatRackLabel(selectedRack, bins),
                    })}
                  </h3>
                  <button type="button" className="btn btn-sm btn-primary" onClick={openAddLevel}>{t('warehouseSimulation.addLevel')}</button>
                </div>
                <div className="sim-simple-level-grid">
                  {rackLevels.map((lvl) => (
                    <button
                      key={lvl.level}
                      type="button"
                      className="sim-simple-level-card"
                      onClick={() => openLevel(lvl.level)}
                    >
                      <strong>{t('warehouseSimulation.levelN', { level: lvl.level })}</strong>
                      <span>
                        {t('warehouseSimulation.rackCounts', {
                          occupied: lvl.occupied,
                          total: lvl.total,
                        })}
                      </span>
                    </button>
                  ))}
                  {!rackLevels.length && (
                    <div className="sim2-empty-hint">{t('warehouseSimulation.noBins')}</div>
                  )}
                </div>
              </>
            )}

            {navStep === 3 && currentLevel && (
              <>
                <div className="sim-simple-panel-head">
                  <h3 className="sim-simple-title">
                    {t('warehouseSimulation.levelOfRack', {
                      level: selectedLevel,
                      rack: formatRackLabel(selectedRack, bins),
                    })}
                  </h3>
                  <div className="sim-simple-panel-actions">
                    <button type="button" className="btn btn-sm" onClick={openAddSlot}>{t('warehouseSimulation.addSlot')}</button>
                    {selected && (
                      <button type="button" className="btn btn-sm btn-primary" onClick={openAddPallet}>{t('warehouseSimulation.addPalletPlus')}</button>
                    )}
                  </div>
                </div>
                <div className="sim2-level-slots">
                  {currentLevel.bins.map((bin) => {
                    const status = binSlotStatus(bin);
                    const qty = Number(bin.total_qty || 0);
                    const stock = binStockView(bin);
                    return (
                      <button
                        key={bin.bin_id}
                        type="button"
                        className={`sim2-slot-chip status-${status}${selectedBin === bin.bin_id ? ' is-active' : ''}`}
                        onClick={() => selectBin(bin.bin_id)}
                      >
                        <strong>P{bin.position ?? bin.position_num ?? '?'}</strong>
                        <span>{bin.bin_code}</span>
                        <span>{qty > 0 ? `SL ${qty}` : 'Trống'}</span>
                        {stock.pallets.slice(0, 2).map((p) => (
                          <em key={p.pallet_id}>{p.pallet_code || p.sku || p.pallet_id}</em>
                        ))}
                        {!stock.pallets.length && stock.unpalletized.slice(0, 2).map((c) => (
                          <em key={`${c.item_id}-${c.lot_number || 'x'}`}>{c.sku || c.item_name}</em>
                        ))}
                        {!stock.pallets.length && !stock.unpalletized.length && stock.emptyPallets.slice(0, 1).map((p) => (
                          <em key={p.pallet_id}>
                          {t('warehouseSimulation.palletEmptyMark', { code: p.pallet_code })}
                        </em>
                        ))}
                      </button>
                    );
                  })}
                </div>

                {selected && (() => {
                  const stock = binStockView(selected);
                  const hasAnything = stock.pallets.length
                    || stock.emptyPallets.length
                    || stock.unpalletized.length;
                  return (
                  <div className="sim2-detail-card" style={{ marginTop: 16 }}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>
                      {t('warehouseSimulation.binN', { code: selected.bin_code })}
                    </div>
                    <div className="sim2-detail-row"><span>{t('common.onHand')}</span><strong>{selected.total_qty}</strong></div>
                    {stock.pallets.length > 0 && (
                      <div className="sim2-pallet-list">
                        <div className="sim2-pallet-list-title">{t('warehouseSimulation.palletsWithStock')}</div>
                        {stock.pallets.map((pallet) => (
                          <button
                            key={pallet.pallet_id}
                            type="button"
                            className={`sim-slot-pallet-item${selectedPallet === pallet.pallet_id ? ' is-active' : ''}`}
                            onClick={() => setSelectedPallet(pallet.pallet_id)}
                            style={{ textAlign: 'left' }}
                          >
                            <strong>{pallet.pallet_code || pallet.pallet_id}</strong>
                            <span>
                              {t('warehouseSimulation.skuQty', {
                                sku: pallet.sku || '-',
                                qty: pallet.quantity_on_hand ?? 0,
                              })}
                            </span>
                            {pallet.lot_code && (
                              <span>{t('warehouseSimulation.lotN', { lot: pallet.lot_code })}</span>
                            )}
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
                              onClick={() => setSelectedPallet(pallet.pallet_id)}
                              style={{ flex: '1 1 160px', textAlign: 'left' }}
                            >
                              <strong>{pallet.pallet_code || pallet.pallet_id}</strong>
                              <span>{t('warehouseSimulation.emptyReady')}</span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => openBinSlot(selected.bin_id, pallet.pallet_id)}
                            >
                              {t('warehouseSimulation.moveIn')}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {stock.unpalletized.length > 0 && (
                      <div className="sim2-pallet-list">
                        <div className="sim2-pallet-list-title">{t('warehouseSimulation.unpalletized')}</div>
                        {stock.unpalletized.map((row) => (
                          <div key={`${row.item_id}-${row.lot_number || 'x'}`} className="sim-slot-pallet-item" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                            <div style={{ flex: '1 1 160px' }}>
                              <strong>{row.sku || row.item_name || row.item_id}</strong>
                              {row.item_name && row.sku && <span>{row.item_name}</span>}
                              <span>
                                {t('warehouseSimulation.qtyN', {
                                  qty: row.quantity_on_hand ?? 0,
                                })}
                                {row.lot_number
                                  ? ` · ${t('warehouseSimulation.lotN', { lot: row.lot_number })}`
                                  : ''}
                              </span>
                            </div>
                            <button type="button" className="btn btn-sm btn-primary" onClick={() => openAttachPallet(row)}>
                              {t('warehouseSimulation.attachPallet')}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {!hasAnything && (
                      <div className="sim2-empty-hint">{t('warehouseSimulation.binEmpty')}</div>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => openBinSlot(selected.bin_id, selectedPallet, moveLot)}
                      >
                        {selectedPalletData
                          ? t('warehouseSimulation.moveForPallet', {
                            code: selectedPalletData.pallet_code || 'pallet',
                          })
                          : t('warehouseSimulation.moveShared')}
                      </button>
                      <button type="button" className="btn btn-sm" onClick={openAddPallet}>{t('warehouseSimulation.createPallet')}</button>
                      {selectedPalletData && Number(selectedPalletData.quantity_on_hand || 0) > 0 && (
                        <>
                          <button type="button" className="btn btn-sm" onClick={() => printSlip('inbound', selectedPalletData, selected)}>
                            {t('warehouseSimulation.printInbound')}
                          </button>
                          <button type="button" className="btn btn-sm" onClick={() => printSlip('outbound', selectedPalletData, selected)}>
                            {t('warehouseSimulation.printOutbound')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  );
                })()}
              </>
            )}
          </div>
        </>
      )}

      {slotModalOpen && selected && (
        <Modal
          title={selectedPalletData
            ? t('warehouseSimulation.moveForPallet', {
              code: selectedPalletData.pallet_code || t('warehouseSimulation.pallet'),
            })
            : t('warehouseSimulation.binN', { code: selected.bin_code })}
          onClose={() => setSlotModalOpen(false)}
          size="wide"
          footer={(
            <>
              <button type="button" className="btn" onClick={() => setSlotModalOpen(false)}>{t('common.close')}</button>
              <button type="button" className="btn btn-primary" disabled={moveBusy} onClick={() => submitMove('ADD')}>
                {moveBusy ? '…' : t('warehouseSimulation.moveIn')}
              </button>
              <button type="button" className="btn" disabled={moveBusy} onClick={() => submitMove('REMOVE')}>
                {moveBusy ? '…' : t('warehouseSimulation.moveOut')}
              </button>
            </>
          )}
        >
          <div className="sim-slot-modal">
            {selectedPalletData && (
              <p className="sim2-empty-hint" style={{ marginTop: 0 }}>
                {Number(selectedPalletData.quantity_on_hand || 0) > 0
                  ? t('warehouseSimulation.palletQty', {
                    code: selectedPalletData.pallet_code,
                    qty: selectedPalletData.quantity_on_hand,
                  })
                  : t('warehouseSimulation.palletEmptyHint', {
                    code: selectedPalletData.pallet_code,
                  })}
              </p>
            )}
            {!selectedPallet && (
              <p className="sim2-empty-hint" style={{ marginTop: 0 }}>
                {t('warehouseSimulation.noPalletHint')}
              </p>
            )}
            <div className="sim-slot-section">
              <h4>{t('warehouseSimulation.scanSku')}</h4>
              <div className="sim-slot-form-row">
                <SkuBarcodeAutocomplete
                  useLookupSearch
                  showNoMatch
                  inputRef={skuInputRef}
                  listId="sim-slot-sku-options"
                  placeholder={t('warehouseSimulation.scanSkuPlaceholder')}
                  value={skuQuery}
                  onChange={(v) => {
                    setSkuQuery(v);
                    setSelectedItem(null);
                  }}
                  onItemSelect={setSelectedItem}
                />
                <input className="form-input" style={{ width: 110 }} type="number" min="1" value={moveQty} onChange={(e) => setMoveQty(e.target.value)} />
              </div>
              {moveError && <div className="form-error" style={{ marginTop: 8 }}>{moveError}</div>}
              {moveMsg && <div className="form-success" style={{ marginTop: 8 }}>{moveMsg}</div>}
            </div>
          </div>
        </Modal>
      )}

      {attachOpen && selected && attachRow && (
        <Modal
          title={t('warehouseSimulation.attachTitle', {
            item: attachRow.sku || attachRow.item_name,
          })}
          onClose={() => { setAttachOpen(false); setAttachRow(null); setAttachError(''); }}
          footer={(
            <>
              <button type="button" className="btn" onClick={() => { setAttachOpen(false); setAttachRow(null); }}>{t('common.cancel')}</button>
              <button type="button" className="btn btn-primary" disabled={attachBusy} onClick={submitAttachPallet}>
                {attachBusy ? '…' : t('warehouseSimulation.attachPallet')}
              </button>
            </>
          )}
        >
          <p className="sim2-empty-hint" style={{ marginTop: 0 }}>
            {t('warehouseSimulation.attachHint')}
          </p>
          <div className="form-group">
            <label>{t('warehouseSimulation.pallet')}</label>
            <select
              className="form-select"
              value={attachForm.pallet_id || 'new'}
              onChange={(e) => setAttachForm({ ...attachForm, pallet_id: e.target.value })}
            >
              <option value="new">{t('warehouseSimulation.newPallet')}</option>
              {binStockView(selected).emptyPallets.map((p) => (
                <option key={p.pallet_id} value={String(p.pallet_id)}>
                  {t('warehouseSimulation.palletEmptyMark', {
                    code: p.pallet_code || p.pallet_id,
                  })}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>{t('warehouseSimulation.attachQty')}</label>
            <input
              className="form-input"
              type="number"
              min="1"
              max={attachRow.quantity_on_hand}
              value={attachForm.quantity ?? ''}
              onChange={(e) => setAttachForm({ ...attachForm, quantity: e.target.value })}
            />
          </div>
          {attachRow.lot_number && (
            <div className="form-group">
              <label>{t('warehouseSimulation.lot')}</label>
              <input className="form-input" value={attachRow.lot_number} readOnly />
            </div>
          )}
          {attachError && <div className="form-error">{attachError}</div>}
        </Modal>
      )}

      {addModal === 'zone' && (
        <Modal
          title={t('warehouseSimulation.addZoneTitle')}
          onClose={closeAddModal}
          footer={(
            <>
              <button type="button" className="btn" onClick={closeAddModal}>{t('common.cancel')}</button>
              <button type="button" className="btn btn-primary" disabled={addBusy} onClick={submitAddZone}>
                {addBusy ? '…' : t('warehouseSimulation.createZone')}
              </button>
            </>
          )}
        >
          <div className="form-group">
            <label>{t('warehouseSimulation.zoneCode')}</label>
            <input className="form-input" value={addForm.zone_code || ''} onChange={(e) => setAddForm({ ...addForm, zone_code: e.target.value })} placeholder="VD: STG-A" />
          </div>
          <div className="form-group">
            <label>{t('warehouseSimulation.zoneName')}</label>
            <input className="form-input" value={addForm.zone_name || ''} onChange={(e) => setAddForm({ ...addForm, zone_name: e.target.value })} placeholder={t('warehouseSimulation.zoneNameExample')} />
          </div>
          <div className="form-group">
            <label>{t('warehouseSimulation.zoneType')}</label>
            <select className="form-select" value={addForm.zone_type || 'STORAGE'} onChange={(e) => setAddForm({ ...addForm, zone_type: e.target.value })}>
              {ZONE_TYPES.map((zt) => <option key={zt} value={zt}>{t(`zones.type.${zt}`)}</option>)}
            </select>
          </div>
          {addError && <div className="form-error">{addError}</div>}
        </Modal>
      )}

      {addModal === 'rack' && (
        <Modal
          title={t('warehouseSimulation.addRackTitle', {
            zone: selectedZone?.zone_name || '',
          })}
          onClose={closeAddModal}
          footer={(
            <>
              <button type="button" className="btn" onClick={closeAddModal}>{t('common.cancel')}</button>
              <button type="button" className="btn btn-primary" disabled={addBusy} onClick={submitAddRack}>
                {addBusy ? '…' : t('warehouseSimulation.createRack')}
              </button>
            </>
          )}
        >
          <p className="sim2-empty-hint" style={{ marginTop: 0 }}>
            {t('warehouseSimulation.addRackHint')}
          </p>
          <div className="form-row">
            <div className="form-group">
              <label>{t('warehouseSimulation.aisle')}</label>
              <input className="form-input" value={addForm.aisle || ''} onChange={(e) => setAddForm({ ...addForm, aisle: e.target.value })} placeholder={t('warehouseSimulation.aisleExample')} />
            </div>
            <div className="form-group">
              <label>{t('warehouseSimulation.bayCount')}</label>
              <input className="form-input" type="number" min="1" value={addForm.bay || ''} onChange={(e) => setAddForm({ ...addForm, bay: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('warehouseSimulation.levelCount')}</label>
              <input className="form-input" type="number" min="1" value={addForm.levels || '4'} onChange={(e) => setAddForm({ ...addForm, levels: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('warehouseSimulation.slotsPerLevel')}</label>
              <input className="form-input" type="number" min="1" value={addForm.positions || '1'} onChange={(e) => setAddForm({ ...addForm, positions: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>{t('warehouseSimulation.binType')}</label>
            <select className="form-select" value={addForm.bin_type || 'Pickable'} onChange={(e) => setAddForm({ ...addForm, bin_type: e.target.value })}>
              {/* The value is the stored bin_type; only the label moves. */}
              <option value="Pickable">{t('warehouseSimulation.binTypePickable')}</option>
              <option value="Staging">{t('warehouseSimulation.binTypeStaging')}</option>
              <option value="PickableStaging">
                {t('warehouseSimulation.binTypePickableStaging')}
              </option>
            </select>
          </div>
          {addError && <div className="form-error">{addError}</div>}
        </Modal>
      )}

      {addModal === 'level' && (
        <Modal
          title={t('warehouseSimulation.addLevelTitle', {
            rack: formatRackLabel(selectedRack, bins),
          })}
          onClose={closeAddModal}
          footer={(
            <>
              <button type="button" className="btn" onClick={closeAddModal}>{t('common.cancel')}</button>
              <button type="button" className="btn btn-primary" disabled={addBusy} onClick={submitAddLevel}>
                {addBusy ? '…' : t('warehouseSimulation.createLevel')}
              </button>
            </>
          )}
        >
          <div className="form-row">
            <div className="form-group">
              <label>{t('warehouseSimulation.levelNumber')}</label>
              <input className="form-input" type="number" min="1" value={addForm.level || ''} onChange={(e) => setAddForm({ ...addForm, level: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('warehouseSimulation.slotsOnLevel')}</label>
              <input className="form-input" type="number" min="1" value={addForm.positions || '1'} onChange={(e) => setAddForm({ ...addForm, positions: e.target.value })} />
            </div>
          </div>
          {addError && <div className="form-error">{addError}</div>}
        </Modal>
      )}

      {addModal === 'slot' && (
        <Modal
          title={t('warehouseSimulation.addSlotTitle', {
            level: addForm.level || selectedLevel,
          })}
          onClose={closeAddModal}
          footer={(
            <>
              <button type="button" className="btn" onClick={closeAddModal}>{t('common.cancel')}</button>
              <button type="button" className="btn btn-primary" disabled={addBusy} onClick={submitAddSlot}>
                {addBusy ? '…' : t('warehouseSimulation.createSlot')}
              </button>
            </>
          )}
        >
          <div className="form-row">
            <div className="form-group">
              <label>{t('warehouseSimulation.level')}</label>
              <input className="form-input" type="number" min="1" value={addForm.level || ''} onChange={(e) => setAddForm({ ...addForm, level: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('warehouseSimulation.position')}</label>
              <input className="form-input" type="number" min="1" value={addForm.position || ''} onChange={(e) => setAddForm({ ...addForm, position: e.target.value })} />
            </div>
          </div>
          {addError && <div className="form-error">{addError}</div>}
        </Modal>
      )}

      {addModal === 'pallet' && selected && (
        <Modal
          title={t('warehouseSimulation.addPalletTitle', { bin: selected.bin_code })}
          onClose={closeAddModal}
          footer={(
            <>
              <button type="button" className="btn" onClick={closeAddModal}>{t('common.cancel')}</button>
              <button type="button" className="btn btn-primary" disabled={addBusy} onClick={submitAddPallet}>
                {addBusy ? '…' : t('warehouseSimulation.createPallet')}
              </button>
            </>
          )}
        >
          <div className="form-group">
            <label>{t('warehouseSimulation.palletCode')}</label>
            <input className="form-input" value={addForm.pallet_code || ''} onChange={(e) => setAddForm({ ...addForm, pallet_code: e.target.value, pallet_barcode: e.target.value })} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('warehouseSimulation.itemId')}</label>
              <input className="form-input" value={addForm.item_id || ''} onChange={(e) => setAddForm({ ...addForm, item_id: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('warehouseSimulation.quantity')}</label>
              <input className="form-input" type="number" min="0" value={addForm.quantity ?? '0'} onChange={(e) => setAddForm({ ...addForm, quantity: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('warehouseSimulation.lot')}</label>
              <input className="form-input" value={addForm.lot_code || ''} onChange={(e) => setAddForm({ ...addForm, lot_code: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('warehouseSimulation.expiry')}</label>
              <input className="form-input" type="date" value={addForm.expiry_date || ''} onChange={(e) => setAddForm({ ...addForm, expiry_date: e.target.value })} />
            </div>
          </div>
          <p className="sim2-empty-hint" style={{ marginBottom: 0 }}>
            {t('warehouseSimulation.addPalletHint')}
          </p>
          {addError && <div className="form-error">{addError}</div>}
        </Modal>
      )}
    </div>
  );
}
