import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '../i18n/locale.jsx';
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
} from '../pages/warehouse3d/model.js';

// jsdom has no WebGL: the Canvas renders a placeholder and never mounts
// the three.js children. Everything the scene draws is shaped by the pure
// helpers tested below.
const canvasProps = vi.fn();
vi.mock('@react-three/fiber', () => ({
  Canvas: (props) => {
    canvasProps(props);
    return <div data-testid="r3f-canvas" aria-label={props['aria-label']} />;
  },
  useThree: () => ({}),
  useFrame: () => {},
}));
vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
  Html: () => null,
  Line: () => null,
}));

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock('../api.js', () => ({
  api: {
    get: (...args) => getMock(...args),
    post: (...args) => postMock(...args),
  },
}));
vi.mock('../warehouse.jsx', () => ({
  useWarehouse: () => ({
    warehouseId: 1,
    warehouse: { warehouse_id: 1, warehouse_name: 'Kho Test' },
  }),
}));

import Warehouse3D from '../pages/Warehouse3D.jsx';

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
    contents: [{ item_id: 7, sku: 'SKU-COFFEE', item_name: 'Cà phê', lot_number: 'L1', expiry_date: '2026-10-01', quantity_on_hand: 10, pallet_id: null }],
  }),
  bin({
    bin_id: 2, bin_code: 'A-01-02', aisle: 'A', bay: '01', level: 2, position: 1,
    rack_key: '1|A|01', rack_label: 'A-001', total_qty: 0,
  }),
  bin({
    bin_id: 3, bin_code: 'A-02-01', aisle: 'A', bay: '02', level: 1, position: 2,
    rack_key: '1|A|02', rack_label: 'A-002', total_qty: 100,
    contents: [{ item_id: 8, sku: 'SKU-TEA', item_name: 'Trà', lot_number: null, expiry_date: '2027-03-01', quantity_on_hand: 100, pallet_id: 50 }],
    pallets: [{ pallet_id: 50, pallet_code: 'PL-50', sku: 'SKU-TEA', quantity_on_hand: 100, expiry_date: '2027-03-01' }],
  }),
  bin({
    bin_id: 4, bin_code: 'B-01-01', aisle: 'B', bay: '01', level: 1, position: 1,
    rack_key: '1|B|01', rack_label: 'B-001', total_qty: 5,
    contents: [{ item_id: 9, sku: 'SKU-MILK', item_name: 'Sữa', lot_number: 'LM', expiry_date: '2026-10-20', quantity_on_hand: 5, pallet_id: null }],
  }),
  bin({
    bin_id: 5, bin_code: 'RCV-01', zone_id: 2, zone_code: 'RCV', aisle: null, bay: null,
    level: 1, position: 1, rack_key: '2|X|RCV-01', rack_label: 'Kệ RCV', total_qty: 0,
  }),
];

const MAP = {
  warehouse_id: 1,
  warehouse_code: 'WH',
  warehouse_name: 'Kho Test',
  layout: { config: { coordinate_unit: 'LEGACY_CANVAS' }, racks: [], paths: [], has_saved_layout: false },
  zones: [
    { zone_id: 1, zone_code: 'PICK', zone_name: 'Pick zone', color: '#36B37E', bounds: null },
    { zone_id: 2, zone_code: 'RCV', zone_name: 'Receiving', color: '#4C9AFF', bounds: null },
  ],
  bins: BINS,
  racks: [],
};

const BATCHES = {
  warehouse_id: 1,
  batches: [{
    batch_id: 9,
    batch_number: 'BATCH-9',
    status: 'IN_PROGRESS',
    orders: ['SO-1', 'SO-2'],
    tasks: [
      { pick_task_id: 3, pick_sequence: 30, bin_id: 4, bin_code: 'B-01-01', sku: 'SKU-MILK', quantity_to_pick: 2, status: 'PENDING' },
      { pick_task_id: 1, pick_sequence: 10, bin_id: 1, bin_code: 'A-01-01', sku: 'SKU-COFFEE', quantity_to_pick: 1, status: 'PICKED' },
      { pick_task_id: 2, pick_sequence: 10, bin_id: 1, bin_code: 'A-01-01', sku: 'SKU-COFFEE', quantity_to_pick: 3, status: 'PICKED' },
    ],
  }],
};

// ------------------------------------------------------------------ model

describe('warehouse3d model: layout', () => {
  it('auto-lays racks by aisle and bay when no floor plan is saved', () => {
    const model = buildSceneModel(MAP);
    expect(model.source).toBe('auto');
    expect(model.racks).toHaveLength(4);
    const a1 = model.racks.find((r) => r.rack_key === '1|A|01');
    const a2 = model.racks.find((r) => r.rack_key === '1|A|02');
    const b1 = model.racks.find((r) => r.rack_key === '1|B|01');
    // Same aisle: one row, bay 02 to the right of bay 01.
    expect(a2.y).toBeCloseTo(a1.y);
    expect(a2.x).toBeGreaterThan(a1.x);
    // Next aisle: the next row down.
    expect(b1.y).toBeGreaterThan(a1.y);
    expect(a1.levels).toBe(2);
    expect(a2.positions).toBe(2);
    // Every rack sits inside its zone and the floor covers every zone.
    model.racks.forEach((r) => {
      const z = model.zones.find((zz) => zz.zone_id === r.zone_id);
      expect(r.x).toBeGreaterThanOrEqual(z.x);
      expect(r.x + r.w).toBeLessThanOrEqual(z.x + z.w + 1e-9);
    });
    model.zones.forEach((z) => {
      expect(z.x).toBeGreaterThanOrEqual(model.floor.x);
      expect(z.x + z.w).toBeLessThanOrEqual(model.floor.x + model.floor.w + 1e-9);
    });
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
    const zone = model.zones.find((z) => z.zone_id === 1);
    expect(zone).toMatchObject({ x: 8, y: 3, w: 20, h: 10 });
    expect(model.floor).toMatchObject({ x: 0, y: 0 });
    expect(model.floor.w).toBeGreaterThanOrEqual(50);
  });

  it('puts each bin on its level and position along the rack', () => {
    const model = buildSceneModel(MAP);
    const places = placeBins(model);
    const p1 = places.find((p) => p.bin_id === 1);
    const p2 = places.find((p) => p.bin_id === 2);
    const p3 = places.find((p) => p.bin_id === 3);
    // Level 2 is one level height above level 1, same plan spot.
    expect(p2.x).toBeCloseTo(p1.x);
    expect(p2.z).toBeCloseTo(p1.z);
    expect(p2.y - p2.sy / 2).toBeCloseTo(p1.y - p1.sy / 2 + LEVEL_HEIGHT);
    // Stocked bins are boxes, empty ones a thin slab.
    expect(p1.sy).toBeGreaterThan(p2.sy * 5);
    // Position 2 of a two-slot rack sits in the right half.
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
    // 4 m rack, 2 slots: slot 2 is +1 m from centre (2, 0.5) along x,
    // which after a 90° turn is +1 m along plan y.
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

describe('warehouse3d model: heatmap', () => {
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
    expect(expiryBucket(bin({ total_qty: 3, contents: [{ quantity_on_hand: 3 }] }), NOW)).toBe('none');
  });

  it('maps every bin to a colour key per mode', () => {
    expect(colorKeys(BINS, 'status').get(2)).toBe('status-empty');
    expect(colorKeys(BINS, 'fill').get(3)).toBe('fill4');
    expect(colorKeys(BINS, 'expiry', NOW).get(4)).toBe('expiry-soon');
  });

  it('dims bins outside a search toward the background', () => {
    const palette = { background: '#000000', 'status-occupied': '#ffffff', 'status-empty': '#ffffff' };
    const keys = colorKeys(BINS, 'status');
    const colors = binColorMap(BINS, keys, palette, new Set([1]));
    expect(colors.get(1)).toBe('#ffffff');
    expect(colors.get(3)).toBe(mixHex('#ffffff', '#000000', 0.78));
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('warehouse3d model: search and pick path', () => {
  it('matches SKU, lot, pallet and bin code like the 2D page', () => {
    expect([...searchMatches(BINS, 'sku-tea').binIds]).toEqual([3]);
    expect([...searchMatches(BINS, 'LM').binIds]).toEqual([4]);
    expect([...searchMatches(BINS, 'PL-50').binIds]).toEqual([3]);
    expect([...searchMatches(BINS, 'A-01').binIds]).toEqual([1, 2]);
    expect(searchMatches(BINS, 'nothing').binIds.size).toBe(0);
  });

  it('orders stops by pick_sequence and merges tasks in the same bin', () => {
    const places = placeBins(buildSceneModel(MAP));
    const path = buildPickPath([
      ...BATCHES.batches[0].tasks,
      { pick_task_id: 4, pick_sequence: 40, bin_id: 999, bin_code: 'GONE', quantity_to_pick: 1, status: 'PENDING' },
    ], places);
    expect(path.stops.map((s) => s.bin_code)).toEqual(['A-01-01', 'B-01-01']);
    expect(path.stops[0]).toMatchObject({ index: 1, quantity: 4, done: true });
    expect(path.stops[1]).toMatchObject({ index: 2, quantity: 2, done: false });
    expect(path.missing).toBe(1);
    expect(path.segments).toHaveLength(1);
    const [seg] = path.segments;
    const [x1, , z1] = path.stops[0].point;
    const [x2, , z2] = path.stops[1].point;
    expect(seg.yaw).toBeCloseTo(Math.atan2(x2 - x1, z2 - z1));
  });
});

// ------------------------------------------------------------------- page

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

function renderPage() {
  return render(
    <MemoryRouter>
      <LocaleProvider>
        <Warehouse3D />
      </LocaleProvider>
    </MemoryRouter>,
  );
}

describe('Warehouse3D page', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    canvasProps.mockReset();
    getMock.mockImplementation((path) => {
      if (path.startsWith('/admin/warehouse-map/pick-paths')) return ok(BATCHES);
      if (path.startsWith('/admin/warehouse-map')) return ok(MAP);
      return ok({});
    });
  });

  it('loads the map and pick batches for the warehouse', async () => {
    const view = renderPage();
    await view.findByTestId('r3f-canvas');
    expect(getMock).toHaveBeenCalledWith('/admin/warehouse-map?warehouse_id=1');
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(
      '/admin/warehouse-map/pick-paths?warehouse_id=1',
      { silentPermissionDenied: true },
    ));
    expect(view.getByText('3D warehouse — Kho Test')).toBeInTheDocument();
    expect(view.getByText('5 bins · 4 racks')).toBeInTheDocument();
    expect(view.getByRole('link', { name: 'Open 2D simulation' })).toHaveAttribute('href', '/warehouse-simulation');
  });

  it('switches the colour mode and shows its legend', async () => {
    const view = renderPage();
    await view.findByTestId('r3f-canvas');
    expect(view.getByText('Expiring soon')).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Fill level' }));
    expect(view.getByRole('button', { name: 'Fill level' })).toHaveAttribute('aria-pressed', 'true');
    expect(view.getByText('Full (over 75%)')).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Expiry' }));
    expect(view.getByText('Expires within 30 days')).toBeInTheDocument();
  });

  it('searches, counts matches and opens a bin from the results', async () => {
    const view = renderPage();
    await view.findByTestId('r3f-canvas');
    fireEvent.change(view.getByRole('textbox', { name: 'Search SKU, lot, pallet or bin' }), {
      target: { value: 'SKU-TEA' },
    });
    expect(view.getByTestId('wh3d-match-count')).toHaveTextContent('1 matching bins');
    const results = view.getByText('Matching bins').closest('.sim2-detail-card');
    fireEvent.click(within(results).getByRole('button', { name: /A-02-01/ }));
    expect(view.getByText('Bin A-02-01')).toBeInTheDocument();
    expect(view.getByText('PL-50')).toBeInTheDocument();
  });

  it('draws the chosen pick batch as numbered stops', async () => {
    const view = renderPage();
    await view.findByTestId('r3f-canvas');
    const select = await view.findByRole('combobox', { name: 'Pick route' });
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
    fireEvent.change(select, { target: { value: '9' } });
    expect(view.getByText('2 stops, 1 picked')).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: /B-01-01/ }));
    expect(view.getByText('Bin B-01-01')).toBeInTheDocument();
    // The unpalletized row offers the shared attach-pallet action.
    fireEvent.click(view.getByRole('button', { name: 'Attach pallet' }));
    expect(view.getByText('Attach pallet · SKU-MILK')).toBeInTheDocument();
  });

  it('shows a hint until a bin is chosen', async () => {
    const view = renderPage();
    await view.findByTestId('r3f-canvas');
    expect(view.getByText(/Click a bin to see what it holds/)).toBeInTheDocument();
  });
});
