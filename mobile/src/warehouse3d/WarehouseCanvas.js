import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber/native';
import * as THREE from 'three';
import { segmentStrips } from './sceneUtils.js';

/**
 * The three.js scene of the mobile 3D warehouse view (read-only).
 *
 * Mirrors admin/src/pages/warehouse3d/WarehouseScene.jsx, cut down for
 * low-power Android handhelds:
 *   - every repeated box (bins, shelves, posts, path strips, stop pins)
 *     is one instanced draw call;
 *   - Lambert / basic materials, one directional light, no shadows,
 *     no antialiasing;
 *   - frameloop "demand": nothing renders unless the camera moves or a
 *     prop changes (the screen calls invalidate on every gesture step);
 *   - no drei, no in-scene text: labels are plain RN Text drawn by the
 *     screen over the canvas, and gestures / picking are handled there
 *     too, so the canvas takes no touch events at all.
 */

const noRaycast = () => null;

function composeInstances(mesh, items, colorOf) {
  if (!mesh) return;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  items.forEach((it, i) => {
    p.set(it.x, it.y, it.z);
    e.set(0, it.rotationY || 0, 0);
    q.setFromEuler(e);
    s.set(it.sx, it.sy, it.sz);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (colorOf) mesh.setColorAt(i, colorOf(it, i));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

/** One instanced draw for a list of boxes; per-instance colours optional. */
function Boxes({
  items, color, colorOf, basic = false, opacity = 1, wireframe = false,
}) {
  const ref = useRef(null);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const c = new THREE.Color();
    composeInstances(ref.current, items, colorOf ? (it, i) => c.set(colorOf(it, i)) : null);
    if (ref.current?.material) ref.current.material.needsUpdate = true;
    invalidate();
  }, [items, colorOf, invalidate]);
  if (!items.length) return null;
  const transparent = opacity < 1;
  // Per-instance colours multiply the material colour, so leave it white.
  const tint = colorOf ? {} : { color };
  return (
    <instancedMesh key={items.length} ref={ref} args={[undefined, undefined, items.length]} raycast={noRaycast}>
      <boxGeometry args={[1, 1, 1]} />
      {basic ? (
        <meshBasicMaterial
          {...tint}
          transparent={transparent}
          opacity={opacity}
          depthWrite={!transparent}
          wireframe={wireframe}
        />
      ) : (
        <meshLambertMaterial {...tint} />
      )}
    </instancedMesh>
  );
}

function Floor({ floor, zones, palette }) {
  // All zone outlines in one line-segment geometry.
  const outline = useMemo(() => {
    const pts = [];
    const cols = [];
    const c = new THREE.Color();
    zones.forEach((z) => {
      const y = 0.02;
      const corners = [[z.x, z.y], [z.x + z.w, z.y], [z.x + z.w, z.y + z.h], [z.x, z.y + z.h]];
      c.set(z.color || palette.zoneFallback);
      corners.forEach(([x1, z1], i) => {
        const [x2, z2] = corners[(i + 1) % 4];
        pts.push(x1, y, z1, x2, y, z2);
        cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
      });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    return g;
  }, [zones, palette.zoneFallback]);
  useEffect(() => () => outline.dispose(), [outline]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[floor.x + floor.w / 2, 0, floor.y + floor.h / 2]} raycast={noRaycast}>
        <planeGeometry args={[floor.w, floor.h]} />
        <meshBasicMaterial color={palette.floor} />
      </mesh>
      {zones.map((z) => (
        <mesh
          key={z.zone_id}
          rotation-x={-Math.PI / 2}
          position={[z.x + z.w / 2, 0.01, z.y + z.h / 2]}
          raycast={noRaycast}
        >
          <planeGeometry args={[z.w, z.h]} />
          <meshBasicMaterial color={z.color || palette.zoneFallback} transparent opacity={0.2} depthWrite={false} />
        </mesh>
      ))}
      {zones.length > 0 && (
        <lineSegments geometry={outline} raycast={noRaycast}>
          <lineBasicMaterial vertexColors />
        </lineSegments>
      )}
    </group>
  );
}

const PIN_SIZE = 0.38;

/**
 * Pick route: floor strips between stops (walked part faded), a pin
 * above every stop, and a tall beacon plus a glow shell on the next one.
 */
function PickRoute({ path, nextIndex, nextPlacement, palette }) {
  const { todo, done } = useMemo(() => {
    if (!path) return { todo: [], done: [] };
    const strips = segmentStrips(path.segments);
    // Segment i runs from stop i to stop i+1 (zero-length hops were
    // dropped, so match on the start point).
    const walked = [];
    const ahead = [];
    strips.forEach((strip, i) => {
      const from = path.segments[i].from;
      const fromIdx = path.stops.findIndex((s) => s.point === from);
      if (nextIndex >= 0 && fromIdx >= 0 && fromIdx < nextIndex) walked.push(strip);
      else ahead.push(strip);
    });
    return { todo: ahead, done: walked };
  }, [path, nextIndex]);

  const pins = useMemo(() => (path?.stops || []).map((s) => ({
    x: s.marker[0],
    y: s.marker[1],
    z: s.marker[2],
    sx: PIN_SIZE,
    sy: PIN_SIZE,
    sz: PIN_SIZE,
    done: s.done,
    next: path.stops.indexOf(s) === nextIndex,
  })), [path, nextIndex]);
  const poles = useMemo(() => (path?.stops || []).map((s) => ({
    x: s.point[0],
    y: (s.point[1] + s.marker[1]) / 2,
    z: s.point[2],
    sx: 0.05,
    sy: Math.max(0.01, s.marker[1] - s.point[1]),
    sz: 0.05,
  })), [path]);

  const pinColor = useMemo(() => (it) => {
    if (it.next) return palette.selection;
    return it.done ? palette.done : palette.path;
  }, [palette]);

  const beacon = useMemo(() => {
    if (!nextPlacement) return [];
    const top = nextPlacement.top + 6;
    return [{ x: nextPlacement.x, y: top / 2, z: nextPlacement.z, sx: 0.18, sy: top, sz: 0.18 }];
  }, [nextPlacement]);
  const shell = useMemo(() => (nextPlacement ? [{
    ...nextPlacement,
    sx: nextPlacement.sx * 1.25 + 0.1,
    sy: nextPlacement.sy * 1.25 + 0.1,
    sz: nextPlacement.sz * 1.25 + 0.1,
  }] : []), [nextPlacement]);

  if (!path || !path.stops.length) return null;
  return (
    <group>
      <Boxes items={todo} color={palette.path} basic />
      <Boxes items={done} color={palette.done} basic />
      <Boxes items={poles} color={palette.path} basic />
      <Boxes items={pins} colorOf={pinColor} basic />
      <Boxes items={beacon} color={palette.selection} basic opacity={0.55} />
      <Boxes items={shell} color={palette.selection} basic opacity={0.4} />
    </group>
  );
}

/** Hands the camera and invalidate() to the screen, which drives both. */
function CameraBridge({ onReady }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    onReady({ camera, invalidate });
  }, [camera, invalidate, onReady]);
  return null;
}

const GL_OPTIONS = { antialias: false, powerPreference: 'low-power' };

function WarehouseCanvas({
  model,
  placements,
  frames,
  binColors,
  matchPlacements,
  selectedPlacement,
  pickPath,
  nextIndex,
  nextPlacement,
  palette,
  initialPosition,
  onReady,
}) {
  // Read once: the screen moves the camera itself after mount, and a new
  // camera object here would make r3f build a fresh camera.
  const cameraRef = useRef(null);
  if (!cameraRef.current) {
    cameraRef.current = {
      position: initialPosition,
      fov: 45,
      near: 0.1,
      far: Math.max(2000, Math.max(model.floor.w, model.floor.h) * 20),
    };
  }
  const colorOfBin = useMemo(
    () => (pl) => binColors.get(pl.bin_id) || palette.fallback,
    [binColors, palette.fallback],
  );
  const glow = useMemo(() => matchPlacements.map((p) => ({
    ...p, sx: p.sx * 1.18 + 0.06, sy: p.sy * 1.18 + 0.06, sz: p.sz * 1.18 + 0.06,
  })), [matchPlacements]);
  const selection = useMemo(() => (selectedPlacement ? [{
    ...selectedPlacement,
    sx: selectedPlacement.sx + 0.12,
    sy: selectedPlacement.sy + 0.12,
    sz: selectedPlacement.sz + 0.12,
  }] : []), [selectedPlacement]);

  return (
    <Canvas
      style={{ flex: 1 }}
      frameloop="demand"
      gl={GL_OPTIONS}
      camera={cameraRef.current}
    >
      <color attach="background" args={[palette.background]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[30, 60, 20]} intensity={0.9} />
      <Floor floor={model.floor} zones={model.zones} palette={palette} />
      <Boxes items={frames.shelves} color={palette.rack} />
      <Boxes items={frames.posts} color={palette.rackPost} />
      <Boxes items={placements} colorOf={colorOfBin} />
      <Boxes items={glow} color={palette.glow} basic opacity={0.38} />
      <Boxes items={selection} color={palette.selection} basic wireframe />
      <PickRoute path={pickPath} nextIndex={nextIndex} nextPlacement={nextPlacement} palette={palette} />
      <CameraBridge onReady={onReady} />
    </Canvas>
  );
}

export default React.memo(WarehouseCanvas);
