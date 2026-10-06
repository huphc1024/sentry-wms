// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  binColorMap,
  buildPickPath,
  buildSceneModel,
  cameraPreset,
  colorKeys,
  daysUntil,
  expiryBucket,
  fillBucket,
  fillReference,
  LEVEL_HEIGHT,
  mixHex,
  placeBins,
  rackFrames,
  rotatePoint,
  searchMatches,
} from '../model.js';
import { binStockView } from '../binModel.js';
import { LEGENDS, paletteFromVars, scenePalette } from '../palette.js';

/**
 * The mobile 3D view runs on a copy of the admin page's pure model
 * (admin/src/pages/warehouse3d/model.js). These are the admin model tests
 * against the copy, plus a drift check, so the handheld and the web panel
 * keep placing and colouring bins the same way.
 */

const NOW = new Date(2026, 9, 6, 9, 0, 0);

function bin(over) {
  return {
    zone_id: 1,
    zone_code: 'PICK',
    contents: [],
    pallets: [],
    total_qty: 0,
    ...over,
  };
}

const BINS = [
  bin({
    bin_id: 1, bin_code: 'A-01-01', aisle: 'A', bay: '01', level: 1, position: 1,
    rack_key: '1|A|01', rack_label: 'A-001', total_qty: 10,
    contents: [{ item_id: 7, sku: 'SKU-COFFEE', item_name: 'Coffee', lot_number: 'L1', expiry_date: '2026-10-01', quantity_on_hand: 10, pallet_id: null }],
  }),
  bin({
    bin_id: 2, bin_code: 'A-01-02', aisle: 'A', bay: '01', level: 2, position: 1,
    rack_key: '1|A|01', rack_label: 'A-001', total_qty: 0,
  }),
  bin({
    bin_id: 3, bin_code: 'A-02-01', aisle: 'A', bay: '02', level: 1, position: 2,
    rack_key: '1|A|02', rack_label: 'A-002', total_qty: 100,
    contents: [{ item_id: 8, sku: 'SKU-TEA', item_name: 'Tea', lot_number: null, expiry_date: '2027-03-01', quantity_on_hand: 100, pallet_id: 50 }],
    pallets: [{ pallet_id: 50, pallet_code: 'PL-50', sku: 'SKU-TEA', quantity_on_hand: 100, expiry_date: '2027-03-01' }],
  }),
  bin({
    bin_id: 4, bin_code: 'B-01-01', aisle: 'B', bay: '01', level: 1, position: 1,
    rack_key: '1|B|01', rack_label: 'B-001', total_qty: 5,
    contents: [{ item_id: 9, sku: 'SKU-MILK', item_name: 'Milk', lot_number: 'LM', expiry_date: '2026-10-20', quantity_on_hand: 5, pallet_id: null }],
  }),
  bin({
    bin_id: 5, bin_code: 'RCV-01', zone_id: 2, zone_code: 'RCV', aisle: null, bay: null,
    level: 1, position: 1, rack_key: '2|X|RCV-01', rack_label: 'RCV rack', total_qty: 0,
  }),
];

const MAP = {
  warehouse_id: 1,
  layout: { config: { coordinate_unit: 'LEGACY_CANVAS' }, racks: [], paths: [], has_saved_layout: false },
  zones: [
    { zone_id: 1, zone_code: 'PICK', zone_name: 'Pick zone', color: '#36B37E', bounds: null },
    { zone_id: 2, zone_code: 'RCV', zone_name: 'Receiving', color: null, bounds: null },
  ],
  bins: BINS,
  racks: [],
};

const TASKS = [
  { pick_task_id: 3, pick_sequence: 30, bin_id: 4, bin_code: 'B-01-01', quantity_to_pick: 2, status: 'PENDING' },
  { pick_task_id: 1, pick_sequence: 10, bin_id: 1, bin_code: 'A-01-01', quantity_to_pick: 1, status: 'PICKED' },
  { pick_task_id: 2, pick_sequence: 10, bin_id: 1, bin_code: 'A-01-01', quantity_to_pick: 3, status: 'PICKED' },
];

describe('mobile warehouse3d model: layout', () => {
  it('auto-lays racks by aisle and bay when no floor plan is saved', () => {
    const model = buildSceneModel(MAP);
    expect(model.source).toBe('auto');
    expect(model.racks).toHaveLength(4);
    const a1 = model.racks.find((r) => r.rack_key === '1|A|01');
    const a2 = model.racks.find((r) => r.rack_key === '1|A|02');
    const b1 = model.racks.find((r) => r.rack_key === '1|B|01');
    expect(a2.y).toBeCloseTo(a1.y);
    expect(a2.x).toBeGreaterThan(a1.x);
    expect(b1.y).toBeGreaterThan(a1.y);
    expect(a1.levels).toBe(2);
    expect(a2.positions).toBe(2);
    model.racks.forEach((r) => {
      const z = model.zones.find((zz) => zz.zone_id === r.zone_id);
      expect(r.x).toBeGreaterThanOrEqual(z.x);
      expect(r.x + r.w).toBeLessThanOrEqual(z.x + z.w + 1e-9);
    });
  });

  it('leaves a zone without a colour to the palette (no literal fallback)', () => {
    const model = buildSceneModel(MAP);
    expect(model.zones.find((z) => z.zone_id === 1).color).toBe('#36B37E');
    expect(model.zones.find((z) => z.zone_id === 2).color).toBeNull();
  });

  it('uses saved meter positions, rotation and zone bounds when present', () => {
    const map = {
      ...MAP,
      layout: {
        has_saved_layout: true,
        config: {
          coordinate_unit: 'METER', warehouse_x_m: 0, warehouse_y_m: 0, warehouse_w_m: 50, warehouse_h_m: 40,
        },
        racks: [{ rack_id: null, rack_key: '1|A|01', x_m: 10, y_m: 5, w_m: 4, h_m: 1, rotation_deg: 90 }],
      },
      zones: [
        { ...MAP.zones[0], bounds: { x: 8, y: 3, w: 20, h: 10, coordinate_unit: 'METER' } },
        MAP.zones[1],
      ],
    };
    const model = buildSceneModel(map);
    expect(model.source).toBe('layout');
    const a1 = model.racks.find((r) => r.rack_key === '1|A|01');
    expect(a1).toMatchObject({ x: 10, y: 5, w: 4, h: 1, rotationDeg: 90, saved: true });
    expect(model.zones.find((z) => z.zone_id === 1)).toMatchObject({ x: 8, y: 3, w: 20, h: 10 });
    expect(model.floor.w).toBeGreaterThanOrEqual(50);
  });

  it('puts each bin on its level and position along the rack', () => {
    const model = buildSceneModel(MAP);
    const places = placeBins(model);
    const p1 = places.find((p) => p.bin_id === 1);
    const p2 = places.find((p) => p.bin_id === 2);
    const p3 = places.find((p) => p.bin_id === 3);
    expect(p2.x).toBeCloseTo(p1.x);
    expect(p2.z).toBeCloseTo(p1.z);
    expect(p2.y - p2.sy / 2).toBeCloseTo(p1.y - p1.sy / 2 + LEVEL_HEIGHT);
    expect(p1.sy).toBeGreaterThan(p2.sy * 5);
    const a2 = model.racks.find((r) => r.rack_key === '1|A|02');
    expect(p3.x).toBeGreaterThan(a2.x + a2.w / 2);
  });

  it('rotates bin positions about the rack centre', () => {
    const p = rotatePoint(10, 10, 1, 0, 90);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(11);
    const model = buildSceneModel({
      ...MAP,
      bins: [bin({ bin_id: 1, bin_code: 'X', aisle: 'A', bay: '1', level: 1, position: 2, rack_key: 'k', total_qty: 1 })],
      layout: {
        has_saved_layout: true,
        config: { coordinate_unit: 'METER' },
        racks: [{ rack_key: 'k', x_m: 0, y_m: 0, w_m: 4, h_m: 1, rotation_deg: 90 }],
      },
    });
    model.racks[0].positions = 2;
    const [place] = placeBins(model);
    expect(place.x).toBeCloseTo(2);
    expect(place.z).toBeCloseTo(1.5);
    expect(place.rotationY).toBeCloseTo(-Math.PI / 2);
  });

  it('builds four posts and one shelf per level for each rack', () => {
    const model = buildSceneModel(MAP);
    const { shelves, posts } = rackFrames(model);
    expect(posts).toHaveLength(model.racks.length * 4);
    expect(shelves).toHaveLength(model.racks.reduce((s, r) => s + r.levels, 0));
  });

  it('gives camera presets centred on the floor', () => {
    const floor = { x: 0, y: 0, w: 40, h: 20 };
    expect(cameraPreset(floor, 'top').target).toEqual([20, 0, 10]);
    expect(cameraPreset(floor, 'top').position[1]).toBeGreaterThan(40);
  });
});

describe('mobile warehouse3d model: heatmap buckets', () => {
  it('measures fill against the 95th percentile of stocked bins', () => {
    const bins = Array.from({ length: 20 }, (_, i) => ({ total_qty: i + 1 })).concat([{ total_qty: 0 }]);
    expect(fillReference(bins)).toBe(19);
    expect(fillReference([])).toBe(0);
  });

  it('buckets fill in quarters, 0 for empty', () => {
    expect(fillBucket(0, 100)).toBe(0);
    expect(fillBucket(10, 100)).toBe(1);
    expect(fillBucket(25, 100)).toBe(1);
    expect(fillBucket(26, 100)).toBe(2);
    expect(fillBucket(60, 100)).toBe(3);
    expect(fillBucket(500, 100)).toBe(4);
    expect(fillBucket(3, 0)).toBe(4);
  });

  it('buckets expiry by the soonest dated stock', () => {
    expect(daysUntil('2026-10-07', NOW)).toBe(1);
    expect(daysUntil('2026-10-05', NOW)).toBe(-1);
    expect(expiryBucket(BINS[0], NOW)).toBe('expired');
    expect(expiryBucket(BINS[3], NOW)).toBe('soon');
    expect(expiryBucket(BINS[2], NOW)).toBe('ok');
    expect(expiryBucket(BINS[1], NOW)).toBe('none');
  });

  it('maps every bin to a colour key per mode', () => {
    expect(colorKeys(BINS, 'status').get(2)).toBe('status-empty');
    expect(colorKeys(BINS, 'fill').get(3)).toBe('fill4');
    expect(colorKeys(BINS, 'expiry', NOW).get(4)).toBe('expiry-soon');
  });

  it('dims bins outside a search toward the background', () => {
    const palette = {
      background: '#000000', fallback: '#111111', 'status-occupied': '#ffffff', 'status-empty': '#ffffff',
    };
    const keys = colorKeys(BINS, 'status');
    const colors = binColorMap(BINS, keys, palette, new Set([1]));
    expect(colors.get(1)).toBe('#ffffff');
    expect(colors.get(3)).toBe(mixHex('#ffffff', '#000000', 0.78));
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    // Unknown key falls back to palette.fallback.
    expect(binColorMap(BINS, new Map(), palette, null).get(1)).toBe('#111111');
  });

  it('has a palette colour for every legend row in every mode', () => {
    const vars = {
      '--map-surface': '#ffffff', '--map-surface-2': '#fafafa', '--map-fill': '#eeeeee',
      '--map-border-strong': '#cccccc', '--map-muted': '#999999', '--map-accent': '#0000ff',
      '--map-accent-strong': '#000099', '--map-ok': '#00ff00', '--map-warn': '#ffff00',
      '--map-bad': '#ff0000', '--map-special': '#ff00ff', zoneFallback: '#888888',
      labelText: '#000000', labelBg: '#ffffff',
    };
    const palette = scenePalette(vars);
    expect(palette.fill2).toBe(mixHex('#00ff00', '#ffff00', 0.5));
    expect(palette.zoneFallback).toBe('#888888');
    Object.values(LEGENDS).flat().forEach(([key]) => {
      expect(palette[key]).toMatch(/^#[0-9a-f]{6}$/i);
    });
    expect(paletteFromVars(vars).background).toBe('#fafafa');
  });
});

describe('mobile warehouse3d model: search, stock view and pick path', () => {
  it('matches SKU, lot, pallet and bin code like the web page', () => {
    expect([...searchMatches(BINS, 'sku-tea').binIds]).toEqual([3]);
    expect([...searchMatches(BINS, 'LM').binIds]).toEqual([4]);
    expect([...searchMatches(BINS, 'PL-50').binIds]).toEqual([3]);
    expect([...searchMatches(BINS, 'A-01').binIds]).toEqual([1, 2]);
    expect(searchMatches(BINS, 'nothing').binIds.size).toBe(0);
  });

  it('splits a bin into pallets and loose stock', () => {
    expect(binStockView(BINS[0]).unpalletized).toHaveLength(1);
    expect(binStockView(BINS[2]).pallets.map((p) => p.pallet_code)).toEqual(['PL-50']);
    expect(binStockView(BINS[2]).unpalletized).toHaveLength(0);
  });

  it('orders stops by pick_sequence and merges tasks in the same bin', () => {
    const places = placeBins(buildSceneModel(MAP));
    const path = buildPickPath([
      ...TASKS,
      { pick_task_id: 4, pick_sequence: 40, bin_id: 999, bin_code: 'GONE', quantity_to_pick: 1, status: 'PENDING' },
    ], places);
    expect(path.stops.map((s) => s.bin_code)).toEqual(['A-01-01', 'B-01-01']);
    expect(path.stops[0]).toMatchObject({ index: 1, quantity: 4, done: true });
    expect(path.stops[1]).toMatchObject({ index: 2, quantity: 2, done: false });
    expect(path.missing).toBe(1);
    expect(path.segments).toHaveLength(1);
  });
});

describe('drift from the admin copy', () => {
  const ROOT = `${globalThis.process.cwd()}/..`;
  const admin = (p) => readFileSync(`${ROOT}/admin/src/pages/${p}`, 'utf8').replace(/\r\n/g, '\n');
  const mobile = (p) => readFileSync(`${globalThis.process.cwd()}/src/warehouse3d/${p}`, 'utf8').replace(/\r\n/g, '\n');
  // Function bodies only: the header comment, import path, the two
  // documented colour fallbacks and i18n-guard markers are the allowed
  // differences.
  const body = (src) => src
    .slice(src.indexOf('export const LEVEL_HEIGHT'))
    .replace(" || '#95A5A6'", ' || null')
    .replace(" || palette.fallback || '#888888'", ' || palette.fallback')
    .replace(/ \/\/ i18n-ignore[^\n]*/g, '');

  it('keeps model.js identical to the admin model apart from the documented changes', () => {
    let adminSrc;
    try {
      adminSrc = admin('warehouse3d/model.js');
    } catch {
      return; // admin app not checked out next to mobile
    }
    expect(body(mobile('model.js'))).toBe(body(adminSrc));
  });

  it('keeps matchingLocations identical to the admin bin model', () => {
    let adminSrc;
    try {
      adminSrc = admin('simulation/binModel.js');
    } catch {
      return;
    }
    const fn = (src) => src.slice(src.indexOf('export function matchingLocations'), src.indexOf('\n}\n', src.indexOf('export function matchingLocations')));
    expect(fn(mobile('binModel.js'))).toBe(fn(adminSrc));
  });
});
