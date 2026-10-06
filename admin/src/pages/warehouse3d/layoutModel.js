/**
 * Floor-plan editing for the 3D page: the draft the 2D layout editor
 * works on, its geometry helpers, and the payload for
 * PUT /api/admin/warehouse-map/layout.
 *
 * Pure functions only, unit-tested in jsdom.
 *
 * Frame: metres, x to the right, y down. A rack is stored as its
 * unrotated rectangle (x, y, w, h) plus `rotationDeg`, turned clockwise
 * about its centre -- the convention of model.js and of the backend's
 * rotated-footprint checks.
 */

import { buildSceneModel } from './model.js';

export const DEFAULT_GRID = 0.25;
export const MIN_SIZE = 0.5;
export const MAX_WORLD = 500;
/** Gap below which two racks count as touching (backend _rect_overlap). */
export const OVERLAP_GAP = 0.05;
const EPS = 0.01;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- numbers

export function round3(v) {
  return Math.round(Number(v) * 1000) / 1000;
}

export function snap(value, step) {
  const v = Number(value);
  if (!(step > 0)) return round3(v);
  return round3(Math.round(v / step) * step);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Degrees folded into [0, 360), as the schema requires. */
export function normDeg(deg) {
  const d = round3(((Number(deg) || 0) % 360 + 360) % 360);
  return d >= 360 ? 0 : d;
}

// ---------------------------------------------------------------- geometry

/** Axis-aligned box of a (possibly rotated) item, about its centre. */
export function footprint(item) {
  const a = (Number(item.rotationDeg) || 0) * DEG;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const fw = item.w * cos + item.h * sin;
  const fh = item.w * sin + item.h * cos;
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  return { x: cx - fw / 2, y: cy - fh / 2, w: fw, h: fh };
}

export function rectsOverlap(a, b, gap = OVERLAP_GAP) {
  return !(
    a.x + a.w + gap <= b.x
    || b.x + b.w + gap <= a.x
    || a.y + a.h + gap <= b.y
    || b.y + b.h + gap <= a.y
  );
}

export function insideRect(inner, outer, eps = EPS) {
  return inner.x >= outer.x - eps
    && inner.y >= outer.y - eps
    && inner.x + inner.w <= outer.x + outer.w + eps
    && inner.y + inner.h <= outer.y + outer.h + eps;
}

function rotate(x, y, deg) {
  const a = (deg || 0) * DEG;
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
}

/**
 * Resize by dragging a corner handle. `handle` is 'nw' | 'ne' | 'sw' |
 * 'se' of the unrotated rectangle; (dx, dy) is the pointer delta on the
 * plan. The opposite corner stays where it is on the plan, also for a
 * rotated rack; width and height snap to the grid.
 */
export function resizeRect(rect, handle, dx, dy, { step = DEFAULT_GRID, min = MIN_SIZE } = {}) {
  const sx = handle.includes('e') ? 1 : -1;
  const sy = handle.includes('s') ? 1 : -1;
  const rot = Number(rect.rotationDeg) || 0;
  const local = rotate(dx, dy, -rot);
  const w = Math.max(min, snap(rect.w + sx * local.x, step));
  const h = Math.max(min, snap(rect.h + sy * local.y, step));
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const off = rotate(-sx * rect.w / 2, -sy * rect.h / 2, rot);
  const anchor = { x: cx + off.x, y: cy + off.y };
  const back = rotate(sx * w / 2, sy * h / 2, rot);
  const ncx = anchor.x + back.x;
  const ncy = anchor.y + back.y;
  return { ...rect, x: round3(ncx - w / 2), y: round3(ncy - h / 2), w, h };
}

// ---------------------------------------------------------------- draft

function rackLayoutId(rack) {
  return rack.id;
}

/**
 * The editable draft for a /admin/warehouse-map payload: the saved meter
 * layout when there is one, otherwise the automatic layout the 3D view
 * draws, moved so the floor starts at (0, 0) -- saving it then
 * "materialises" the automatic layout into metres.
 */
export function buildDraft(mapData) {
  const layout = mapData?.layout || {};
  const cfg = layout.config || {};
  const model = buildSceneModel(mapData);
  const meter = model.source === 'layout';
  const grid = Number(cfg.grid_step_m) > 0 ? Number(cfg.grid_step_m) : DEFAULT_GRID;
  const realZones = new Set((mapData?.zones || []).map((z) => z.zone_id));

  let ox = 0;
  let oy = 0;
  let bounds;
  if (meter) {
    bounds = {
      x: Number(cfg.warehouse_x_m) || 0,
      y: Number(cfg.warehouse_y_m) || 0,
      w: Number(cfg.warehouse_w_m) || model.floor.w,
      h: Number(cfg.warehouse_h_m) || model.floor.h,
    };
  } else {
    ox = -model.floor.x;
    oy = -model.floor.y;
    bounds = {
      x: 0,
      y: 0,
      w: Math.min(MAX_WORLD, Math.ceil(model.floor.w / grid) * grid),
      h: Math.min(MAX_WORLD, Math.ceil(model.floor.h / grid) * grid),
    };
  }

  return {
    source: model.source,
    baseVersion: layout.has_saved_layout ? Number(cfg.version) || 0 : 0,
    grid,
    world: {
      w: Number(cfg.world_width_m) || 0,
      h: Number(cfg.world_height_m) || 0,
    },
    bounds: {
      x: round3(bounds.x), y: round3(bounds.y), w: round3(bounds.w), h: round3(bounds.h),
    },
    zones: model.zones.map((z) => ({
      zone_id: z.zone_id,
      code: z.code,
      label: z.label,
      color: z.color,
      persist: realZones.has(z.zone_id),
      x: round3(z.x + ox),
      y: round3(z.y + oy),
      w: round3(z.w),
      h: round3(z.h),
    })),
    racks: model.racks.map((r) => ({
      id: rackLayoutId(r),
      rack_id: r.rack_id ?? null,
      rack_key: r.rack_key,
      zone_id: r.zone_id ?? null,
      label: r.label,
      x: round3(r.x + ox),
      y: round3(r.y + oy),
      w: round3(r.w),
      h: round3(r.h),
      rotationDeg: normDeg(r.rotationDeg),
    })),
    paths: (layout.paths || []).map((p) => ({
      path_id: p.path_id ?? null,
      path_type: p.path_type,
      label: p.label ?? null,
      points: (p.points || []).map((pt) => ({ x: Number(pt.x), y: Number(pt.y) })),
      width_m: Number(p.width_m),
      one_way: Boolean(p.one_way),
      direction: p.direction || 'both',
      sort_order: Number(p.sort_order) || 0,
    })),
  };
}

export function findItem(draft, sel) {
  if (!draft || !sel) return null;
  if (sel.kind === 'zone') return draft.zones.find((z) => z.zone_id === sel.id) || null;
  return draft.racks.find((r) => r.id === sel.id) || null;
}

/** Patch one zone or rack; returns a new draft. */
export function updateItem(draft, sel, patch) {
  if (sel.kind === 'zone') {
    return { ...draft, zones: draft.zones.map((z) => (z.zone_id === sel.id ? { ...z, ...patch } : z)) };
  }
  return { ...draft, racks: draft.racks.map((r) => (r.id === sel.id ? { ...r, ...patch } : r)) };
}

/**
 * Move an item from its position in `from` by (dx, dy), snapped to the
 * grid. Moving a zone with `withRacks` carries the zone's racks along by
 * the same snapped offset.
 */
export function moveItem(from, sel, dx, dy, { withRacks = false } = {}) {
  const item = findItem(from, sel);
  if (!item) return from;
  const x = snap(item.x + dx, from.grid);
  const y = snap(item.y + dy, from.grid);
  let next = updateItem(from, sel, { x, y });
  if (sel.kind === 'zone' && withRacks) {
    const ddx = round3(x - item.x);
    const ddy = round3(y - item.y);
    next = {
      ...next,
      racks: next.racks.map((r) => (r.zone_id === sel.id
        ? { ...r, x: round3(r.x + ddx), y: round3(r.y + ddy) }
        : r)),
    };
  }
  return next;
}

export function rotateItem(draft, sel, deg) {
  if (sel.kind !== 'rack') return draft;
  const item = findItem(draft, sel);
  if (!item) return draft;
  return updateItem(draft, sel, { rotationDeg: normDeg(item.rotationDeg + deg) });
}

/** Set one numeric field from the properties panel; ignores bad input. */
export function setField(draft, sel, field, value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return draft;
  if (field === 'rotationDeg') return updateItem(draft, sel, { rotationDeg: normDeg(v) });
  if (field === 'w' || field === 'h') return updateItem(draft, sel, { [field]: Math.max(MIN_SIZE, round3(v)) });
  return updateItem(draft, sel, { [field]: round3(v) });
}

export function setBounds(draft, field, value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return draft;
  const max = MAX_WORLD - (field === 'w' ? draft.bounds.x : draft.bounds.y);
  return { ...draft, bounds: { ...draft.bounds, [field]: round3(clamp(v, 1, max)) } };
}

// ---------------------------------------------------------------- checks

/**
 * The checks the editor can make without the server: items outside the
 * warehouse and overlapping racks (errors), racks outside their zone
 * (warning). Same rules and shape as the backend's structured issues.
 */
export function localIssues(draft) {
  const issues = [];
  const b = draft.bounds;
  draft.zones.filter((z) => z.persist).forEach((z) => {
    if (!insideRect(z, b)) issues.push({ severity: 'error', code: 'zone_beyond_bounds', zone_ids: [z.zone_id] });
  });
  const fps = draft.racks.map((r) => ({ rack: r, fp: footprint(r) }));
  const zoneById = new Map(draft.zones.map((z) => [z.zone_id, z]));
  fps.forEach(({ rack, fp }) => {
    if (!insideRect(fp, b)) issues.push({ severity: 'error', code: 'rack_beyond_bounds', rack_keys: [rack.rack_key] });
    const zone = zoneById.get(rack.zone_id);
    if (zone && !insideRect(fp, zone)) {
      issues.push({ severity: 'warning', code: 'rack_outside_zone', rack_keys: [rack.rack_key], zone_ids: [zone.zone_id] });
    }
  });
  for (let i = 0; i < fps.length; i += 1) {
    for (let j = i + 1; j < fps.length; j += 1) {
      if (rectsOverlap(fps[i].fp, fps[j].fp)) {
        issues.push({
          severity: 'error',
          code: 'racks_overlap',
          rack_keys: [fps[i].rack.rack_key, fps[j].rack.rack_key],
        });
      }
    }
  }
  return issues;
}

/** Rack keys and zone ids named by issues, split by severity. */
export function issueTargets(issues) {
  const out = {
    errorRacks: new Set(), warnRacks: new Set(), errorZones: new Set(), warnZones: new Set(),
  };
  (issues || []).forEach((i) => {
    const err = i.severity === 'error';
    (i.rack_keys || []).forEach((k) => (err ? out.errorRacks : out.warnRacks).add(k));
    // A rack outside its zone flags the rack, not the zone.
    if (i.code === 'rack_outside_zone') return;
    (i.zone_ids || []).forEach((z) => (err ? out.errorZones : out.warnZones).add(z));
  });
  return out;
}

// ---------------------------------------------------------------- payload

/** Body for POST .../layout/validate and PUT .../layout. */
export function buildPayload(draft) {
  const b = draft.bounds;
  return {
    base_version: draft.baseVersion,
    layout: {
      coordinate_unit: 'METER',
      world_width_m: round3(clamp(Math.max(draft.world.w || 0, b.x + b.w), 1, MAX_WORLD)),
      world_height_m: round3(clamp(Math.max(draft.world.h || 0, b.y + b.h), 1, MAX_WORLD)),
      warehouse_x_m: round3(b.x),
      warehouse_y_m: round3(b.y),
      warehouse_w_m: round3(b.w),
      warehouse_h_m: round3(b.h),
      grid_step_m: draft.grid,
    },
    zones: draft.zones.filter((z) => z.persist).map((z) => ({
      zone_id: z.zone_id,
      map_x: round3(z.x),
      map_y: round3(z.y),
      map_w: round3(z.w),
      map_h: round3(z.h),
    })),
    racks: draft.racks.map((r) => ({
      ...(r.rack_id != null ? { rack_id: r.rack_id } : {}),
      rack_key: r.rack_key,
      zone_id: r.zone_id,
      label: r.label,
      x_m: round3(r.x),
      y_m: round3(r.y),
      w_m: round3(r.w),
      h_m: round3(r.h),
      rotation_deg: normDeg(r.rotationDeg),
    })),
    // Saving replaces the warehouse's paths with this list, so the ones
    // already saved go back unchanged.
    paths: draft.paths,
  };
}

/** The draft in /admin/warehouse-map shape, so the 3D preview follows it live. */
export function draftToMapData(mapData, draft) {
  if (!mapData || !draft) return mapData;
  const zoneById = new Map(draft.zones.map((z) => [z.zone_id, z]));
  const b = draft.bounds;
  return {
    ...mapData,
    layout: {
      ...(mapData.layout || {}),
      has_saved_layout: true,
      config: {
        ...(mapData.layout?.config || {}),
        coordinate_unit: 'METER',
        warehouse_x_m: b.x,
        warehouse_y_m: b.y,
        warehouse_w_m: b.w,
        warehouse_h_m: b.h,
        grid_step_m: draft.grid,
      },
      racks: draft.racks.map((r) => ({
        rack_id: r.rack_id,
        rack_key: r.rack_key,
        zone_id: r.zone_id,
        label: r.label,
        x_m: r.x,
        y_m: r.y,
        w_m: r.w,
        h_m: r.h,
        rotation_deg: r.rotationDeg,
      })),
    },
    zones: (mapData.zones || []).map((z) => {
      const d = zoneById.get(z.zone_id);
      return d
        ? { ...z, bounds: { x: d.x, y: d.y, w: d.w, h: d.h, stored: true, coordinate_unit: 'METER' } }
        : z;
    }),
  };
}

export function sameDraft(a, b) {
  if (!a || !b) return a === b;
  return JSON.stringify(buildPayload(a)) === JSON.stringify(buildPayload(b));
}

// ---------------------------------------------------------------- history

export function historyInit(present) {
  return { past: [], present, future: [] };
}

/** Record `next` as a new step (no-op when nothing changed). */
export function historyPush(h, next, before = h.present) {
  if (next === before || sameDraft(next, before)) return { ...h, present: next };
  return { past: [...h.past, before].slice(-100), present: next, future: [] };
}

/** Show `next` without a new step -- used while a drag is in flight. */
export function historyReplace(h, next) {
  return { ...h, present: next };
}

export function historyUndo(h) {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function historyRedo(h) {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

// ---------------------------------------------------------------- access

export const LAYOUT_EDIT_OVERRIDE = 'warehouse-map-edit';

/** Same rule as the API's _require_layout_edit. */
export function canEditLayout(user) {
  if (!user) return false;
  return user.role === 'ADMIN' || (user.allowed_overrides || []).includes(LAYOUT_EDIT_OVERRIDE);
}
