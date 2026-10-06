/**
 * Geometry and data shaping for the 3D warehouse view.
 *
 * Pure functions only -- no three.js, no React -- so the scene layout,
 * colour buckets, search and pick routes are unit-testable in jsdom.
 *
 * Coordinates: the floor plan is in metres with x to the right and y
 * down (the 2D layout editor's frame). In 3D, plan x -> world X, plan
 * y -> world Z, height -> world Y. A rack rotated by `rotation_deg`
 * turns about its centre, clockwise on the plan, which is a rotation of
 * -deg about world Y.
 */

import { binSlotStatus, matchingLocations } from '../simulation/binModel.js';

export const LEVEL_HEIGHT = 1.1;
export const SLOT_LENGTH = 1.3;
export const RACK_DEPTH = 1.1;
export const AISLE_WIDTH = 2.8;
export const BAY_GAP = 0.15;
export const ZONE_PAD = 1.5;
export const ZONE_GAP = 3;
export const EMPTY_BOX_HEIGHT = 0.08;
export const STOCK_BOX_RATIO = 0.72;
export const PATH_HEIGHT = 0.25;
const FLOOR_SLOTS_PER_ROW = 6;
const DEG = Math.PI / 180;

export function binLevel(bin) {
  return Number(bin?.level ?? bin?.level_num ?? 1) || 1;
}

export function binPosition(bin) {
  return Number(bin?.position ?? bin?.position_num ?? 1) || 1;
}

/** Same identity the backend's group_bins_into_racks uses. */
export function rackIdentity(bin) {
  return bin.rack_id != null ? `id:${bin.rack_id}` : `key:${bin.rack_key || bin.bin_code}`;
}

function bayOrder(a, b) {
  const na = Number(a.bay);
  const nb = Number(b.bay);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return String(a.bay ?? a.label ?? '').localeCompare(String(b.bay ?? b.label ?? ''));
}

/** Group bins into racks with their level / position counts. */
export function groupRacks(bins) {
  const map = new Map();
  (bins || []).forEach((bin) => {
    const id = rackIdentity(bin);
    if (!map.has(id)) {
      map.set(id, {
        id,
        rack_id: bin.rack_id ?? null,
        rack_key: bin.rack_key || null,
        label: bin.rack_label || bin.bin_code,
        zone_id: bin.zone_id,
        aisle: bin.aisle || null,
        bay: bin.bay ?? null,
        bins: [],
        levels: 0,
        positions: 0,
      });
    }
    const rack = map.get(id);
    rack.bins.push(bin);
    rack.levels = Math.max(rack.levels, binLevel(bin));
    rack.positions = Math.max(rack.positions, binPosition(bin));
  });
  return [...map.values()];
}

function rackFootprint(rack) {
  return { w: Math.max(1, rack.positions) * SLOT_LENGTH, h: RACK_DEPTH };
}

/**
 * Lay out racks that have no saved position: one row per aisle (bays in
 * order), racks without an aisle as a grid of floor slots. Returns the
 * racks with x/y relative to (0, 0) and the block's size.
 */
export function autoPlaceRacks(racks) {
  const rows = new Map();
  const loose = [];
  racks.forEach((rack) => {
    if (rack.aisle) {
      if (!rows.has(rack.aisle)) rows.set(rack.aisle, []);
      rows.get(rack.aisle).push(rack);
    } else {
      loose.push(rack);
    }
  });
  const rowList = [...rows.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))
    .map(([, list]) => list.sort(bayOrder));
  const looseSorted = [...loose].sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
  for (let i = 0; i < looseSorted.length; i += FLOOR_SLOTS_PER_ROW) {
    rowList.push(looseSorted.slice(i, i + FLOOR_SLOTS_PER_ROW));
  }
  const placed = [];
  let width = 0;
  rowList.forEach((row, r) => {
    let x = 0;
    const y = r * (RACK_DEPTH + AISLE_WIDTH);
    row.forEach((rack) => {
      const { w, h } = rackFootprint(rack);
      placed.push({ ...rack, x, y, w, h, rotationDeg: 0, saved: false });
      x += w + BAY_GAP;
    });
    width = Math.max(width, x - BAY_GAP);
  });
  const height = rowList.length ? rowList.length * RACK_DEPTH + (rowList.length - 1) * AISLE_WIDTH : 0;
  return { racks: placed, width: Math.max(0, width), height };
}

function bbox(rects) {
  if (!rects.length) return null;
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function isMeterLayout(layout) {
  return Boolean(layout?.has_saved_layout && layout?.config?.coordinate_unit === 'METER');
}

/**
 * Turn the /admin/warehouse-map payload into a floor, zone rectangles and
 * placed racks (metres). Saved positions from the meter layout win; any
 * zone or rack without one is laid out automatically so a warehouse that
 * never had its floor plan drawn still renders.
 */
export function buildSceneModel(mapData) {
  const bins = mapData?.bins || [];
  const zones = mapData?.zones || [];
  const layout = mapData?.layout || {};
  const meter = isMeterLayout(layout);
  const savedById = new Map();
  const savedByKey = new Map();
  if (meter) {
    (layout.racks || []).forEach((r) => {
      if (r.rack_id != null) savedById.set(r.rack_id, r);
      if (r.rack_key) savedByKey.set(r.rack_key, r);
    });
  }

  const racks = groupRacks(bins);
  const zoneIds = [...new Set([...zones.map((z) => z.zone_id), ...racks.map((r) => r.zone_id)])];
  const zoneById = new Map(zones.map((z) => [z.zone_id, z]));

  const placedRacks = [];
  const zoneRects = [];
  const pending = [];

  zoneIds.forEach((zoneId) => {
    const zone = zoneById.get(zoneId) || { zone_id: zoneId };
    const inZone = racks.filter((r) => r.zone_id === zoneId);
    const saved = [];
    const auto = [];
    inZone.forEach((rack) => {
      const s = (rack.rack_id != null && savedById.get(rack.rack_id))
        || (rack.rack_key && savedByKey.get(rack.rack_key));
      if (s && Number.isFinite(Number(s.x_m)) && Number(s.w_m) > 0 && Number(s.h_m) > 0) {
        saved.push({
          ...rack,
          label: s.label || rack.label,
          x: Number(s.x_m),
          y: Number(s.y_m),
          w: Number(s.w_m),
          h: Number(s.h_m),
          rotationDeg: Number(s.rotation_deg) || 0,
          saved: true,
        });
      } else {
        auto.push(rack);
      }
    });
    const block = autoPlaceRacks(auto);
    const b = zone.bounds;
    const meterBounds = b && b.coordinate_unit === 'METER'
      && [b.x, b.y, b.w, b.h].every((v) => Number.isFinite(Number(v)))
      ? { x: Number(b.x), y: Number(b.y), w: Number(b.w), h: Number(b.h) }
      : null;
    const savedBox = bbox(saved);
    placedRacks.push(...saved);
    if (meterBounds || savedBox) {
      const anchor = meterBounds || savedBox;
      const ox = anchor.x + (meterBounds ? ZONE_PAD : 0);
      const oy = savedBox ? savedBox.y + savedBox.h + AISLE_WIDTH : anchor.y + ZONE_PAD;
      block.racks.forEach((r) => placedRacks.push({ ...r, x: r.x + ox, y: r.y + oy }));
      const content = bbox([
        ...(savedBox ? [savedBox] : []),
        ...(block.racks.length ? [{ x: ox, y: oy, w: block.width, h: block.height }] : []),
      ]);
      const rect = meterBounds || {
        x: content.x - ZONE_PAD,
        y: content.y - ZONE_PAD,
        w: content.w + ZONE_PAD * 2,
        h: content.h + ZONE_PAD * 2,
      };
      zoneRects.push({ zone, rect, auto: false });
    } else {
      pending.push({ zone, block });
    }
  });

  // Shelf-pack the zones that have no position at all, below whatever
  // already has one.
  const fixed = bbox(zoneRects.map((z) => z.rect));
  const sizes = pending.map(({ block }) => ({
    w: Math.max(6, block.width + ZONE_PAD * 2),
    h: Math.max(4, block.height + ZONE_PAD * 2),
  }));
  const area = sizes.reduce((s, z) => s + z.w * z.h, 0);
  const maxRow = Math.max(fixed?.w || 0, 30, Math.sqrt(area) * 1.6);
  let cx = fixed ? fixed.x : 0;
  let cy = fixed ? fixed.y + fixed.h + ZONE_GAP : 0;
  let rowH = 0;
  const startX = cx;
  pending.forEach(({ zone, block }, i) => {
    const size = sizes[i];
    if (cx > startX && cx - startX + size.w > maxRow) {
      cx = startX;
      cy += rowH + ZONE_GAP;
      rowH = 0;
    }
    const rect = { x: cx, y: cy, w: size.w, h: size.h };
    block.racks.forEach((r) => placedRacks.push({ ...r, x: r.x + cx + ZONE_PAD, y: r.y + cy + ZONE_PAD }));
    zoneRects.push({ zone, rect, auto: true });
    cx += size.w + ZONE_GAP;
    rowH = Math.max(rowH, size.h);
  });

  const zonesOut = zoneRects.map(({ zone, rect, auto }) => ({
    zone_id: zone.zone_id,
    label: zone.zone_name || zone.zone_code || String(zone.zone_id),
    code: zone.zone_code || '',
    color: zone.color || '#95A5A6',
    auto,
    ...rect,
  }));

  const content = bbox([
    ...zonesOut,
    ...placedRacks.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
  ]) || { x: 0, y: 0, w: 20, h: 20 };
  let floor = { x: content.x - 2, y: content.y - 2, w: content.w + 4, h: content.h + 4 };
  if (meter) {
    const c = layout.config;
    const declared = {
      x: Number(c.warehouse_x_m), y: Number(c.warehouse_y_m),
      w: Number(c.warehouse_w_m), h: Number(c.warehouse_h_m),
    };
    if (Object.values(declared).every(Number.isFinite)) floor = bbox([declared, content]);
  }

  return {
    floor,
    zones: zonesOut,
    racks: placedRacks,
    source: meter ? 'layout' : 'auto',
    maxLevels: Math.max(1, ...placedRacks.map((r) => r.levels || 1)),
  };
}

/** Plan point (lx, ly) relative to a rack's centre, rotated onto the plan. */
export function rotatePoint(cx, cy, lx, ly, rotationDeg) {
  const a = (rotationDeg || 0) * DEG;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
}

/**
 * World-space box for every bin: one slot per position along the rack's
 * long side, one shelf per level. Stocked bins are tall boxes, empty ones
 * a thin slab, so occupancy reads at a glance before any colour does.
 */
export function placeBins(model) {
  const out = [];
  model.racks.forEach((rack) => {
    const alongX = rack.w >= rack.h;
    const length = alongX ? rack.w : rack.h;
    const depth = alongX ? rack.h : rack.w;
    const positions = Math.max(1, rack.positions);
    const slot = length / positions;
    const cx = rack.x + rack.w / 2;
    const cy = rack.y + rack.h / 2;
    rack.bins.forEach((bin) => {
      const level = binLevel(bin);
      const pos = binPosition(bin);
      const along = -length / 2 + (pos - 0.5) * slot;
      const p = rotatePoint(cx, cy, alongX ? along : 0, alongX ? 0 : along, rack.rotationDeg);
      const stocked = Number(bin.total_qty || 0) > 0;
      const sy = stocked ? LEVEL_HEIGHT * STOCK_BOX_RATIO : EMPTY_BOX_HEIGHT;
      const base = (level - 1) * LEVEL_HEIGHT + 0.06;
      const sAlong = slot * 0.86;
      const sDepth = depth * 0.8;
      out.push({
        bin_id: bin.bin_id,
        bin,
        rackId: rack.id,
        x: p.x,
        y: base + sy / 2,
        z: p.y,
        top: base + sy,
        sx: alongX ? sAlong : sDepth,
        sy,
        sz: alongX ? sDepth : sAlong,
        rotationY: -(rack.rotationDeg || 0) * DEG,
      });
    });
  });
  return out;
}

/** Uprights and shelf plates of every rack, for instanced drawing. */
export function rackFrames(model) {
  const shelves = [];
  const posts = [];
  model.racks.forEach((rack) => {
    const cx = rack.x + rack.w / 2;
    const cy = rack.y + rack.h / 2;
    const rotationY = -(rack.rotationDeg || 0) * DEG;
    const levels = Math.max(1, rack.levels);
    for (let l = 0; l < levels; l += 1) {
      shelves.push({ x: cx, y: l * LEVEL_HEIGHT + 0.03, z: cy, sx: rack.w, sy: 0.05, sz: rack.h, rotationY });
    }
    const height = levels * LEVEL_HEIGHT + 0.1;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
      const p = rotatePoint(cx, cy, (sx * rack.w) / 2, (sy * rack.h) / 2, rack.rotationDeg);
      posts.push({ x: p.x, y: height / 2, z: p.y, sx: 0.08, sy: height, sz: 0.08, rotationY });
    });
  });
  return { shelves, posts };
}

// ---------------------------------------------------------------- colour

export const COLOR_MODES = ['status', 'fill', 'expiry'];

/** Status bucket: the 2D page's own rule (empty / occupied / expiring). */
export function statusBucket(bin) {
  return binSlotStatus(bin);
}

/**
 * Reference quantity for "full". Bins carry no unit capacity, so fill is
 * relative to the warehouse: the 95th percentile of stocked bins, which
 * keeps one overstuffed bulk slot from washing every other bin out.
 */
export function fillReference(bins) {
  const qtys = (bins || [])
    .map((b) => Number(b.total_qty || 0))
    .filter((q) => q > 0)
    .sort((a, b) => a - b);
  if (!qtys.length) return 0;
  const idx = Math.max(0, Math.ceil(qtys.length * 0.95) - 1);
  return qtys[idx];
}

/** 0 = empty, 1..4 = quarters of the reference quantity. */
export function fillBucket(qty, reference) {
  const q = Number(qty || 0);
  if (q <= 0) return 0;
  if (!(reference > 0)) return 4;
  const ratio = Math.min(1, q / reference);
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function dayNumber(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000;
}

function todayNumber(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
}

/** Whole days from today to an ISO date (negative once past). */
export function daysUntil(dateValue, now = new Date()) {
  const day = dayNumber(dateValue);
  return day == null ? null : day - todayNumber(now);
}

export const EXPIRY_SOON_DAYS = 30;

/**
 * Expiry bucket from the earliest dated stock in the bin: 'expired',
 * 'soon' (within 30 days), 'ok', or 'none' (empty / no dated stock).
 */
export function expiryBucket(bin, now = new Date()) {
  if (!bin || Number(bin.total_qty || 0) <= 0) return 'none';
  const dates = [
    ...(bin.contents || []).filter((c) => Number(c.quantity_on_hand || 0) > 0).map((c) => c.expiry_date),
    ...(bin.pallets || []).filter((p) => Number(p.quantity_on_hand || 0) > 0).map((p) => p.expiry_date),
  ].filter(Boolean);
  if (!dates.length) return 'none';
  const soonest = Math.min(...dates.map((d) => daysUntil(d, now)).filter((d) => d != null));
  if (!Number.isFinite(soonest)) return 'none';
  if (soonest < 0) return 'expired';
  if (soonest <= EXPIRY_SOON_DAYS) return 'soon';
  return 'ok';
}

/** Colour key per bin for the chosen mode -- the scene maps keys to theme colours. */
export function colorKeys(bins, mode, now = new Date()) {
  const keys = new Map();
  if (mode === 'fill') {
    const ref = fillReference(bins);
    bins.forEach((b) => keys.set(b.bin_id, `fill${fillBucket(b.total_qty, ref)}`));
  } else if (mode === 'expiry') {
    bins.forEach((b) => keys.set(b.bin_id, `expiry-${expiryBucket(b, now)}`));
  } else {
    bins.forEach((b) => keys.set(b.bin_id, `status-${statusBucket(b)}`));
  }
  return keys;
}

function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** Blend two #rrggbb colours; t = 0 gives a, 1 gives b. Bad input returns a. */
export function mixHex(a, b, t) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const k = Math.min(1, Math.max(0, t));
  return `#${ca.map((v, i) => Math.round(v + (cb[i] - v) * k).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Final colour per bin: the mode's key mapped through the palette, and
 * bins outside an active search pushed most of the way to the background.
 */
export function binColorMap(bins, keys, palette, matchIds) {
  const out = new Map();
  (bins || []).forEach((b) => {
    const base = palette[keys.get(b.bin_id)] || palette.fallback || '#888888';
    out.set(b.bin_id, matchIds && !matchIds.has(b.bin_id) ? mixHex(base, palette.background, 0.78) : base);
  });
  return out;
}

// ---------------------------------------------------------------- search

/** Bin ids matching a query, using the 2D page's matching rules. */
export function searchMatches(bins, query) {
  const locations = matchingLocations(bins, query);
  const binIds = new Set(locations.map((l) => l.bin_id));
  return { locations, binIds };
}

// ---------------------------------------------------------------- pick path

/**
 * Stops of a pick batch in walk order: tasks sorted by pick_sequence
 * (then bin code, then task id), consecutive tasks in the same bin merged
 * into one numbered stop. Stops whose bin is not on the map are counted
 * in `missing` and left out of the route.
 */
export function buildPickPath(tasks, placements) {
  const byBin = new Map((placements || []).map((p) => [p.bin_id, p]));
  const ordered = [...(tasks || [])].sort((a, b) => (
    (Number(a.pick_sequence) || 0) - (Number(b.pick_sequence) || 0)
    || String(a.bin_code || '').localeCompare(String(b.bin_code || ''))
    || (Number(a.pick_task_id) || 0) - (Number(b.pick_task_id) || 0)
  ));
  const stops = [];
  let missing = 0;
  ordered.forEach((task) => {
    const last = stops[stops.length - 1];
    if (last && last.bin_id === task.bin_id) {
      last.tasks.push(task);
      return;
    }
    const place = byBin.get(task.bin_id);
    if (!place) {
      missing += 1;
      return;
    }
    stops.push({
      index: stops.length + 1,
      bin_id: task.bin_id,
      bin_code: task.bin_code,
      tasks: [task],
      point: [place.x, PATH_HEIGHT, place.z],
      marker: [place.x, place.top + 0.45, place.z],
    });
  });
  stops.forEach((s) => {
    s.done = s.tasks.every((t) => t.status === 'PICKED' || t.status === 'SHORT');
    s.quantity = s.tasks.reduce((sum, t) => sum + Number(t.quantity_to_pick || 0), 0);
  });
  const segments = [];
  for (let i = 1; i < stops.length; i += 1) {
    const [x1, y, z1] = stops[i - 1].point;
    const [x2, , z2] = stops[i].point;
    const dx = x2 - x1;
    const dz = z2 - z1;
    if (Math.hypot(dx, dz) < 1e-6) continue;
    segments.push({
      from: stops[i - 1].point,
      to: stops[i].point,
      mid: [(x1 + x2) / 2, y, (z1 + z2) / 2],
      // Yaw that turns +Z onto the segment direction.
      yaw: Math.atan2(dx, dz),
    });
  }
  return { stops, segments, missing };
}

/** Camera presets for a floor rectangle. */
export function cameraPreset(floor, kind) {
  const cx = floor.x + floor.w / 2;
  const cz = floor.y + floor.h / 2;
  const span = Math.max(floor.w, floor.h, 10);
  if (kind === 'top') {
    return { position: [cx, span * 1.25, cz + 0.01], target: [cx, 0, cz] };
  }
  return { position: [cx + span * 0.35, span * 0.6, cz + span * 0.7], target: [cx, 0, cz] };
}
