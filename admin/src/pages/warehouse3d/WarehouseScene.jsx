import {
  createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef,
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { cameraPreset } from './model.js';

const noRaycast = () => null;

// drei's <Html> mounts into the canvas's parent unless given a portal, and
// that parent changes once r3f connects its events -- every label then
// unmounts and remounts its own React root mid-render, which React 19
// reports as an error. A stable container of our own avoids the churn.
const OverlayContext = createContext(null);

function Label({ children, ...props }) {
  const portal = useContext(OverlayContext);
  return <Html portal={portal} {...props}>{children}</Html>;
}

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
  mesh.computeBoundingBox?.();
}

/** One instanced draw for every bin; hover and click report the bin id. */
function BinInstances({
  placements, binColors, onHover, onSelect,
}) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const c = new THREE.Color();
    composeInstances(ref.current, placements, (pl) => c.set(binColors.get(pl.bin_id) || '#888888'));
  }, [placements, binColors]);
  if (!placements.length) return null;
  return (
    <instancedMesh
      key={placements.length}
      ref={ref}
      args={[undefined, undefined, placements.length]}
      onPointerMove={(e) => {
        e.stopPropagation();
        const pl = placements[e.instanceId];
        if (pl) onHover(pl.bin_id, e.nativeEvent);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        const pl = placements[e.instanceId];
        if (pl) onSelect(pl.bin_id);
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.65} metalness={0.05} />
    </instancedMesh>
  );
}

/** Translucent shell around search matches: the "glow". */
function MatchGlow({ placements, color }) {
  const ref = useRef(null);
  const grown = useMemo(() => placements.map((p) => ({
    ...p, sx: p.sx * 1.18 + 0.06, sy: p.sy * 1.18 + 0.06, sz: p.sz * 1.18 + 0.06,
  })), [placements]);
  useLayoutEffect(() => { composeInstances(ref.current, grown); }, [grown]);
  if (!grown.length) return null;
  return (
    <instancedMesh key={grown.length} ref={ref} args={[undefined, undefined, grown.length]} raycast={noRaycast}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={color} transparent opacity={0.38} depthWrite={false} />
    </instancedMesh>
  );
}

function StaticInstances({ items, color }) {
  const ref = useRef(null);
  useLayoutEffect(() => { composeInstances(ref.current, items); }, [items]);
  if (!items.length) return null;
  return (
    <instancedMesh key={items.length} ref={ref} args={[undefined, undefined, items.length]} raycast={noRaycast}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={0.8} />
    </instancedMesh>
  );
}

function Floor({ floor, zones, palette }) {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[floor.x + floor.w / 2, 0, floor.y + floor.h / 2]} raycast={noRaycast}>
        <planeGeometry args={[floor.w, floor.h]} />
        <meshBasicMaterial color={palette.floor} />
      </mesh>
      {zones.map((z) => (
        <group key={z.zone_id}>
          <mesh rotation-x={-Math.PI / 2} position={[z.x + z.w / 2, 0.01, z.y + z.h / 2]} raycast={noRaycast}>
            <planeGeometry args={[z.w, z.h]} />
            <meshBasicMaterial color={z.color} transparent opacity={0.2} depthWrite={false} />
          </mesh>
          <Line
            points={[[z.x, 0.02, z.y], [z.x + z.w, 0.02, z.y], [z.x + z.w, 0.02, z.y + z.h], [z.x, 0.02, z.y + z.h], [z.x, 0.02, z.y]]}
            color={z.color}
            lineWidth={1.5}
          />
          <Label position={[z.x + 0.4, 0.05, z.y + 0.4]} className="wh3d-zone-label">
            <span style={{ borderColor: z.color }}>{z.label}</span>
          </Label>
        </group>
      ))}
    </group>
  );
}

function SelectionBox({ placement, color }) {
  if (!placement) return null;
  return (
    <mesh
      position={[placement.x, placement.y, placement.z]}
      rotation-y={placement.rotationY}
      scale={[placement.sx + 0.12, placement.sy + 0.12, placement.sz + 0.12]}
      raycast={noRaycast}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={color} wireframe />
    </mesh>
  );
}

function PickRoute({ path, palette, onSelect }) {
  if (!path || !path.stops.length) return null;
  const points = path.stops.map((s) => s.point);
  return (
    <group>
      {points.length > 1 && <Line points={points} color={palette.path} lineWidth={4} />}
      {path.segments.map((seg, i) => (
        <group key={`seg-${i}`} position={seg.mid} rotation-y={seg.yaw}>
          <mesh rotation-x={Math.PI / 2} raycast={noRaycast}>
            <coneGeometry args={[0.28, 0.6, 12]} />
            <meshBasicMaterial color={palette.path} />
          </mesh>
        </group>
      ))}
      {path.stops.map((s) => (
        <group key={`${s.index}-${s.bin_id}`}>
          <Line points={[s.point, s.marker]} color={palette.path} lineWidth={1} dashed dashSize={0.15} gapSize={0.1} />
          <Label position={s.marker} center>
            <button
              type="button"
              className={`wh3d-stop${s.done ? ' is-done' : ''}`}
              onClick={() => onSelect(s.bin_id)}
            >
              {s.index}
            </button>
          </Label>
        </group>
      ))}
    </group>
  );
}

/** Applies reset / top-down requests to the camera and orbit target. */
function CameraRig({ floor, command }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  // By value: a map reload (refresh, attach pallet) rebuilds the floor
  // object but must not throw the user's camera back to the start.
  const floorKey = [floor.x, floor.y, floor.w, floor.h].map((v) => v.toFixed(2)).join(',');
  useEffect(() => {
    const [x, y, w, h] = floorKey.split(',').map(Number);
    const preset = cameraPreset({ x, y, w, h }, command?.kind || 'reset');
    camera.position.set(...preset.position);
    if (controls) {
      controls.target.set(...preset.target);
      controls.update();
    } else {
      camera.lookAt(...preset.target);
    }
  }, [floorKey, command, camera, controls]);
  return null;
}

/**
 * The three.js scene. Everything it draws comes in as props already
 * shaped by model.js; this file only turns them into meshes.
 */
export default function WarehouseScene({
  model,
  placements,
  frames,
  binColors,
  matchPlacements,
  selectedPlacement,
  pickPath,
  palette,
  viewCommand,
  onHoverBin,
  onSelectBin,
  fallback,
  ariaLabel,
}) {
  const initial = useMemo(() => cameraPreset(model.floor, 'reset'), [model.floor]);
  const overlayRef = useRef(null);
  return (
    <div ref={overlayRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <OverlayContext.Provider value={overlayRef}>
        <Canvas
          camera={{
            position: initial.position,
            fov: 45,
            near: 0.1,
            far: Math.max(2000, Math.max(model.floor.w, model.floor.h) * 20),
          }}
          dpr={[1, 2]}
          fallback={fallback}
          aria-label={ariaLabel}
          onPointerMissed={() => onHoverBin(null)}
        >
          <color attach="background" args={[palette.background]} />
          <ambientLight intensity={0.75} />
          <directionalLight position={[30, 60, 20]} intensity={0.9} />
          <directionalLight position={[-20, 30, -30]} intensity={0.3} />
          <Floor floor={model.floor} zones={model.zones} palette={palette} />
          <StaticInstances items={frames.shelves} color={palette.rack} />
          <StaticInstances items={frames.posts} color={palette.rackPost} />
          <BinInstances
            placements={placements}
            binColors={binColors}
            onHover={onHoverBin}
            onSelect={onSelectBin}
          />
          <MatchGlow placements={matchPlacements} color={palette.glow} />
          <SelectionBox placement={selectedPlacement} color={palette.selection} />
          <PickRoute path={pickPath} palette={palette} onSelect={onSelectBin} />
          <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2 - 0.02} />
          <CameraRig floor={model.floor} command={viewCommand} />
        </Canvas>
      </OverlayContext.Provider>
    </div>
  );
}
