// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildPickPath, buildSceneModel, cameraPreset, placeBins } from '../model.js';
import {
  MAX_PHI,
  MIN_PHI,
  MIN_RADIUS,
  nextStopIndex,
  orbitFocus,
  orbitFromPreset,
  orbitPosition,
  panOrbit,
  pickPlacement,
  projectPoint,
  rayBoxDistance,
  rotateOrbit,
  scanMatches,
  screenRay,
  segmentStrips,
  tasksWithBinIds,
  visibleLabels,
  zoomOrbit,
} from '../sceneUtils.js';

const W = 400;
const H = 600;

function bin(over) {
  return { zone_id: 1, contents: [], pallets: [], total_qty: 0, ...over };
}

const BINS = [
  bin({
    bin_id: 1, bin_code: 'A-01-01', bin_barcode: 'BC-A0101', aisle: 'A', bay: '01', level: 1, position: 1,
    rack_key: 'A|01', total_qty: 4,
    contents: [{ sku: 'SKU-1', lot_number: 'LOT-9', quantity_on_hand: 4, pallet_id: null }],
  }),
  bin({
    bin_id: 2, bin_code: 'A-02-01', bin_barcode: 'BC-A0201', aisle: 'A', bay: '02', level: 1, position: 1,
    rack_key: 'A|02', total_qty: 8,
    pallets: [{ pallet_id: 7, pallet_code: 'PL-7', pallet_barcode: '0099887', sku: 'SKU-2', quantity_on_hand: 8 }],
  }),
  bin({ bin_id: 3, bin_code: 'B-01-01', aisle: 'B', bay: '01', level: 2, position: 1, rack_key: 'B|01' }),
];
const MAP = { zones: [{ zone_id: 1, zone_name: 'Z', color: '#123456' }], bins: BINS, layout: {} };

describe('orbit camera', () => {
  it('round-trips a camera preset', () => {
    const preset = cameraPreset({ x: 0, y: 0, w: 40, h: 20 }, 'reset');
    const orbit = orbitFromPreset(preset);
    const pos = orbitPosition(orbit);
    preset.position.forEach((v, i) => expect(pos[i]).toBeCloseTo(v, 5));
  });

  it('keeps the camera above the floor and out of the rack', () => {
    const o = { target: [0, 0, 0], radius: 10, theta: 0, phi: 0.5 };
    // Like OrbitControls: dragging down swings the camera up over the top.
    expect(rotateOrbit(o, 0, 10000).phi).toBe(MIN_PHI);
    expect(rotateOrbit(o, 0, -10000).phi).toBe(MAX_PHI);
    expect(zoomOrbit(o, 1000).radius).toBe(MIN_RADIUS);
    expect(zoomOrbit(o, 0.001, 50).radius).toBe(50);
    expect(zoomOrbit(o, 2).radius).toBeCloseTo(5);
    expect(zoomOrbit(o, 0)).toBe(o);
  });

  it('turns a one-finger drag into heading and tilt', () => {
    const o = { target: [0, 0, 0], radius: 10, theta: 0, phi: 0.8 };
    const r = rotateOrbit(o, 100, 0);
    expect(r.theta).toBeLessThan(0);
    expect(r.phi).toBeCloseTo(0.8);
  });

  it('pans the target so the floor follows the fingers', () => {
    // Looking down the -Z axis (theta 0): a drag to the right moves the
    // target to -X, a drag down moves it further away (-Z).
    const o = { target: [0, 0, 0], radius: 10, theta: 0, phi: 0.8 };
    const right = panOrbit(o, 50, 0, H);
    expect(right.target[0]).toBeLessThan(0);
    expect(right.target[2]).toBeCloseTo(0);
    const down = panOrbit(o, 0, 50, H);
    expect(down.target[2]).toBeLessThan(0);
    expect(down.target[1]).toBe(0);
  });

  it('frames a point from a fixed distance', () => {
    const o = orbitFocus([5, 1, 7], 12);
    expect(o.target).toEqual([5, 0, 7]);
    expect(o.radius).toBe(12);
  });
});

describe('projection and tap picking', () => {
  const orbit = { target: [0, 0, 0], radius: 20, theta: 0.3, phi: 0.7 };

  it('projects the orbit target to the screen centre', () => {
    const p = projectPoint([0, 0, 0], orbit, W, H);
    expect(p.x).toBeCloseTo(W / 2);
    expect(p.y).toBeCloseTo(H / 2);
    expect(p.visible).toBe(true);
  });

  it('returns null behind the camera and flags off-screen points', () => {
    const eye = orbitPosition(orbit);
    const behind = [eye[0] * 2, eye[1] * 2, eye[2] * 2];
    expect(projectPoint(behind, orbit, W, H)).toBeNull();
    // Far along the camera's right vector: in front of it, off screen.
    const side = [Math.cos(orbit.theta) * 500, 0, -Math.sin(orbit.theta) * 500];
    expect(projectPoint(side, orbit, W, H).visible).toBe(false);
  });

  it('casts a ray from a pixel back through the projected point', () => {
    const point = [2, 1, -3];
    const p = projectPoint(point, orbit, W, H);
    const ray = screenRay(p.x, p.y, orbit, W, H);
    const t = Math.hypot(...point.map((v, i) => v - ray.origin[i]));
    point.forEach((v, i) => expect(ray.origin[i] + ray.dir[i] * t).toBeCloseTo(v, 4));
  });

  it('hits rotated boxes and misses beside them', () => {
    const ray = { origin: [0, 10, 0], dir: [0, -1, 0] };
    const box = { x: 0, y: 0.5, z: 0, sx: 4, sy: 1, sz: 0.2, rotationY: Math.PI / 2 };
    // Rotated 90°: the 4 m side now runs along Z.
    expect(rayBoxDistance(ray, box)).toBeCloseTo(9);
    expect(rayBoxDistance({ origin: [0, 10, 1.5], dir: [0, -1, 0] }, box)).toBeCloseTo(9);
    expect(rayBoxDistance({ origin: [1.5, 10, 0], dir: [0, -1, 0] }, box)).toBeNull();
    expect(rayBoxDistance({ origin: [0, 10, 0], dir: [0, 1, 0] }, box)).toBeNull();
  });

  it('picks the nearest bin under the finger', () => {
    const places = placeBins(buildSceneModel(MAP));
    const target = places.find((p) => p.bin_id === 2);
    const view = { target: [target.x, 0, target.z], radius: 15, theta: 0.2, phi: 0.6 };
    const p = projectPoint([target.x, target.y, target.z], view, W, H);
    const hit = pickPlacement(places, screenRay(p.x, p.y, view, W, H));
    expect(hit.bin_id).toBe(2);
    expect(pickPlacement(places, screenRay(2, 2, view, W, H))).toBeNull();
  });

  it('keeps the nearest labels on screen, priority first, capped', () => {
    const labels = [
      { id: 'far', point: [0, 0, -50] },
      { id: 'near', point: [0, 0, 5] },
      { id: 'next', point: [0, 0, -20], priority: 1 },
      { id: 'off', point: [900, 0, 0] },
    ];
    const out = visibleLabels(labels, { target: [0, 0, 0], radius: 30, theta: 0, phi: 0.8 }, W, H, 2);
    expect(out.map((l) => l.id)).toEqual(['next', 'near']);
  });
});

describe('search and scan', () => {
  it('uses the web rules for SKU / lot / bin code', () => {
    expect([...scanMatches(BINS, 'sku-1').binIds]).toEqual([1]);
    expect([...scanMatches(BINS, 'LOT-9').binIds]).toEqual([1]);
    expect([...scanMatches(BINS, 'A-0').binIds]).toEqual([1, 2]);
    expect(scanMatches(BINS, '  ')).toBeNull();
  });

  it('also matches a scanned bin or pallet barcode exactly', () => {
    expect([...scanMatches(BINS, 'bc-a0201').binIds]).toEqual([2]);
    expect(scanMatches(BINS, '0099887').count).toBe(1);
    expect(scanMatches(BINS, '009988').count).toBe(0);
  });
});

describe('pick walk', () => {
  const places = placeBins(buildSceneModel(MAP));
  const tasks = [
    { pick_task_id: 11, pick_sequence: 1, bin_code: 'A-01-01', quantity_to_pick: 1, status: 'PICKED' },
    { pick_task_id: 12, pick_sequence: 2, bin_code: 'A-02-01', quantity_to_pick: 2, status: 'PENDING' },
    { pick_task_id: 13, pick_sequence: 3, bin_code: 'B-01-01', quantity_to_pick: 1, status: 'PENDING' },
    { pick_task_id: 14, pick_sequence: 4, bin_code: 'NOT-ON-MAP', quantity_to_pick: 1, status: 'PENDING' },
  ];

  it('resolves task bins by code', () => {
    const withIds = tasksWithBinIds(tasks, BINS);
    expect(withIds.map((t) => t.bin_id)).toEqual([1, 2, 3, null]);
    expect(tasksWithBinIds([{ bin_id: 9, bin_code: 'A-01-01' }], BINS)[0].bin_id).toBe(9);
  });

  it('finds the next stop from the current task, else the first open one', () => {
    const path = buildPickPath(tasksWithBinIds(tasks, BINS), places);
    expect(path.stops.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(path.missing).toBe(1);
    expect(nextStopIndex(path, 13)).toBe(2);
    expect(nextStopIndex(path, null)).toBe(1);
    expect(nextStopIndex(path, 999)).toBe(1);
    const allDone = { stops: path.stops.map((s) => ({ ...s, done: true })) };
    expect(nextStopIndex(allDone, null)).toBe(-1);
  });

  it('lays each path segment flat along its direction', () => {
    const path = buildPickPath(tasksWithBinIds(tasks, BINS), places);
    const strips = segmentStrips(path.segments);
    expect(strips).toHaveLength(path.segments.length);
    strips.forEach((s, i) => {
      const seg = path.segments[i];
      expect(s.sz).toBeCloseTo(Math.hypot(seg.to[0] - seg.from[0], seg.to[2] - seg.from[2]));
      expect(s.rotationY).toBe(seg.yaw);
    });
  });
});
