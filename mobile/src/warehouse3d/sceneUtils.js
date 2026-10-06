/**
 * Mobile-only helpers for the 3D warehouse view: orbit camera maths,
 * screen projection for the text labels, tap picking, scan matching and
 * the pick-walk glue.
 *
 * The web page gets these from drei (OrbitControls, Html) and three's
 * raycaster. On the handheld the gestures and labels are plain React
 * Native, so the maths lives here instead -- pure, no three.js, so it is
 * unit-tested in node like model.js.
 *
 * Frames: world X / Z are the floor plan, Y is up (see model.js). An
 * orbit is { target: [x, y, z], radius, theta, phi } with phi measured
 * from straight up (0 = top-down) and theta the heading around Y.
 */

import { searchMatches } from './model.js';

export const FOV_DEG = 45;
export const MIN_PHI = 0.001;
export const MAX_PHI = Math.PI / 2 - 0.02;
export const MIN_RADIUS = 2;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Keep the camera above the floor and within a sensible distance. */
export function clampOrbit(orbit, maxRadius = 2000) {
  return {
    target: [...orbit.target],
    radius: Math.min(maxRadius, Math.max(MIN_RADIUS, orbit.radius)),
    theta: orbit.theta,
    phi: Math.min(MAX_PHI, Math.max(MIN_PHI, orbit.phi)),
  };
}

export function orbitPosition(orbit) {
  const { target, radius, theta, phi } = orbit;
  return [
    target[0] + radius * Math.sin(phi) * Math.sin(theta),
    target[1] + radius * Math.cos(phi),
    target[2] + radius * Math.sin(phi) * Math.cos(theta),
  ];
}

/** Orbit that reproduces a camera preset ({ position, target }) from model.js. */
export function orbitFromPreset(preset) {
  const d = sub(preset.position, preset.target);
  const radius = Math.hypot(d[0], d[1], d[2]);
  return clampOrbit({
    target: [...preset.target],
    radius,
    theta: Math.atan2(d[0], d[2]),
    phi: Math.acos(Math.min(1, Math.max(-1, d[1] / (radius || 1)))),
  });
}

/** Look at one point from a fixed distance, keeping the current heading. */
export function orbitFocus(point, radius, theta = 0, phi = 0.9) {
  return clampOrbit({ target: [point[0], 0, point[2]], radius, theta, phi });
}

/** One-finger drag: pixels -> heading / tilt. */
export function rotateOrbit(orbit, dx, dy, speed = 0.008) {
  return clampOrbit({ ...orbit, theta: orbit.theta - dx * speed, phi: orbit.phi - dy * speed });
}

/** Pinch: factor > 1 spreads the fingers and moves the camera in. */
export function zoomOrbit(orbit, factor, maxRadius) {
  if (!(factor > 0)) return orbit;
  return clampOrbit({ ...orbit, radius: orbit.radius / factor }, maxRadius);
}

/**
 * Two-finger drag: move the target across the floor so the ground under
 * the fingers follows them. Scaled by distance so the speed feels the
 * same zoomed in or out.
 */
export function panOrbit(orbit, dx, dy, viewHeight, fovDeg = FOV_DEG) {
  const h = viewHeight > 0 ? viewHeight : 1;
  const worldPerPx = (2 * orbit.radius * Math.tan((fovDeg * Math.PI) / 360)) / h;
  const right = [Math.cos(orbit.theta), 0, -Math.sin(orbit.theta)];
  // Screen-up on the floor: away from the camera.
  const forward = [-Math.sin(orbit.theta), 0, -Math.cos(orbit.theta)];
  const move = add(scale(right, -dx * worldPerPx), scale(forward, dy * worldPerPx));
  return { ...orbit, target: add(orbit.target, move) };
}

function cameraBasis(orbit) {
  const eye = orbitPosition(orbit);
  const forward = norm(sub(orbit.target, eye));
  let right = cross(forward, [0, 1, 0]);
  if (Math.hypot(...right) < 1e-6) right = [Math.cos(orbit.theta), 0, -Math.sin(orbit.theta)];
  right = norm(right);
  const up = cross(right, forward);
  return { eye, forward, right, up };
}

/**
 * World point -> screen pixels (origin top-left). Returns null when the
 * point is behind the camera; `visible` is false off screen.
 */
export function projectPoint(point, orbit, width, height, fovDeg = FOV_DEG) {
  const { eye, forward, right, up } = cameraBasis(orbit);
  const rel = sub(point, eye);
  const z = dot(rel, forward);
  if (z <= 0.01) return null;
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const aspect = width / (height || 1);
  const ndcX = (dot(rel, right) * f) / (z * aspect);
  const ndcY = (dot(rel, up) * f) / z;
  const x = ((ndcX + 1) / 2) * width;
  const y = ((1 - ndcY) / 2) * height;
  return { x, y, depth: z, visible: Math.abs(ndcX) <= 1.05 && Math.abs(ndcY) <= 1.05 };
}

/** Screen pixel -> world ray { origin, dir }. */
export function screenRay(px, py, orbit, width, height, fovDeg = FOV_DEG) {
  const { eye, forward, right, up } = cameraBasis(orbit);
  const t = Math.tan((fovDeg * Math.PI) / 360);
  const aspect = width / (height || 1);
  const ndcX = (px / width) * 2 - 1;
  const ndcY = 1 - (py / height) * 2;
  const dir = norm(add(forward, add(scale(right, ndcX * t * aspect), scale(up, ndcY * t))));
  return { origin: eye, dir };
}

/** Distance along the ray to a Y-rotated box, or null on a miss. */
export function rayBoxDistance(ray, box) {
  // Into the box's frame: translate, then undo its rotation about Y.
  const c = Math.cos(-(box.rotationY || 0));
  const s = Math.sin(-(box.rotationY || 0));
  const toLocal = (v) => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  const o = toLocal(sub(ray.origin, [box.x, box.y, box.z]));
  const d = toLocal(ray.dir);
  const half = [box.sx / 2, box.sy / 2, box.sz / 2];
  let tMin = -Infinity;
  let tMax = Infinity;
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(d[i]) < 1e-12) {
      if (o[i] < -half[i] || o[i] > half[i]) return null;
    } else {
      let t1 = (-half[i] - o[i]) / d[i];
      let t2 = (half[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return null;
    }
  }
  if (tMax < 0) return null;
  return tMin >= 0 ? tMin : tMax;
}

/**
 * Nearest bin under a ray. Thin empty slabs are hard to hit with a
 * finger, so every box is tested a little taller than it is drawn.
 */
export function pickPlacement(placements, ray, minHeight = 0.35) {
  let best = null;
  (placements || []).forEach((p) => {
    const sy = Math.max(p.sy, minHeight);
    const box = { ...p, sy, y: p.y - p.sy / 2 + sy / 2 };
    const dist = rayBoxDistance(ray, box);
    if (dist != null && (!best || dist < best.dist)) best = { dist, placement: p };
  });
  return best ? best.placement : null;
}

/**
 * Bins matching a search or a scan. Free text uses the web page's rules
 * (SKU / name / lot / pallet / bin code, substring); a scanned barcode
 * also matches a bin or pallet barcode exactly, which the web search
 * never needed because nobody types a barcode.
 */
export function scanMatches(bins, query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const { binIds } = searchMatches(bins, q);
  const ids = new Set(binIds);
  const upper = q.toUpperCase();
  (bins || []).forEach((bin) => {
    if (String(bin.bin_barcode || '').toUpperCase() === upper) ids.add(bin.bin_id);
    const pallets = [...(bin.pallets || []), ...(bin.contents || [])];
    if (pallets.some((p) => String(p.pallet_barcode || '').toUpperCase() === upper)) ids.add(bin.bin_id);
  });
  return { binIds: ids, count: ids.size };
}

/**
 * Pick tasks carry bin_code, not bin_id; give each the id of the map bin
 * with that code so model.buildPickPath can place it.
 */
export function tasksWithBinIds(tasks, bins) {
  const byCode = new Map((bins || []).map((b) => [String(b.bin_code), b.bin_id]));
  return (tasks || []).map((task) => (
    task.bin_id != null ? task : { ...task, bin_id: byCode.get(String(task.bin_code)) ?? null }
  ));
}

/**
 * Index (into path.stops) of the stop the picker walks to next: the one
 * holding the current task, else the first stop not yet picked. -1 when
 * everything is done.
 */
export function nextStopIndex(path, currentTaskId) {
  const stops = path?.stops || [];
  if (currentTaskId != null) {
    const i = stops.findIndex((s) => s.tasks.some((t) => String(t.pick_task_id) === String(currentTaskId)));
    if (i !== -1) return i;
  }
  return stops.findIndex((s) => !s.done);
}

/**
 * Screen labels to draw: projected, on screen, nearest first, capped so
 * a large warehouse does not lay out hundreds of Text views per frame.
 * Each label is { id, point, ... }; extra fields are passed through.
 */
export function visibleLabels(labels, orbit, width, height, max = 30) {
  const out = [];
  (labels || []).forEach((label) => {
    const p = projectPoint(label.point, orbit, width, height);
    if (p && p.visible) out.push({ ...label, x: p.x, y: p.y, depth: p.depth });
  });
  out.sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.depth - b.depth);
  return out.slice(0, max);
}

/** Path segments as flat floor strips: centre, length and heading. */
export function segmentStrips(segments, width = 0.22) {
  return (segments || []).map((seg) => {
    const dx = seg.to[0] - seg.from[0];
    const dz = seg.to[2] - seg.from[2];
    return {
      x: seg.mid[0],
      y: seg.mid[1],
      z: seg.mid[2],
      sx: width,
      sy: 0.04,
      sz: Math.hypot(dx, dz),
      rotationY: seg.yaw,
    };
  });
}
