import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, PanResponder, PixelRatio, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';
import client from '../api/client';
import ScreenHeader from '../components/ScreenHeader';
import ScanInput from '../components/ScanInput';
import { useLocale } from '../i18n/locale';
import { colors, fonts, radii, scene3dColors, screenStyles } from '../theme/styles';
import WarehouseCanvas from '../warehouse3d/WarehouseCanvas';
import { LEGENDS, MODE_LABELS, scenePalette } from '../warehouse3d/palette';
import { binStockView } from '../warehouse3d/binModel';
import {
  binColorMap,
  buildPickPath,
  buildSceneModel,
  cameraPreset,
  colorKeys,
  COLOR_MODES,
  placeBins,
  rackFrames,
} from '../warehouse3d/model';
import {
  clampOrbit,
  nextStopIndex,
  orbitFocus,
  orbitFromPreset,
  orbitPosition,
  panOrbit,
  pickPlacement,
  rotateOrbit,
  scanMatches,
  screenRay,
  tasksWithBinIds,
  visibleLabels,
  zoomOrbit,
} from '../warehouse3d/sceneUtils';

/**
 * Read-only 3D warehouse view for floor users (pickers included).
 *
 * Data: GET /api/warehouse-map (the mobile map endpoint, same payload the
 * admin 3D page reads) and, in pick-route mode, the picker's own batch
 * via GET /api/picking/batch/:id. Nothing on this screen writes.
 *
 * Opened lazily from the navigator so three.js / expo-gl only load when
 * someone actually opens it.
 */

const palette = scenePalette(scene3dColors);

// expo-gl always renders at the device pixel ratio; to cap it, the GL
// view is laid out smaller and scaled up. 1.5 keeps edges acceptable on
// a 5-6" handheld while cutting fragment work roughly in half on a
// PixelRatio 2 device.
const MAX_RENDER_DPR = 1.5;
const RENDER_SCALE = Math.min(1, MAX_RENDER_DPR / (PixelRatio.get() || 1));

const MAX_LABELS = 30;
const TAP_SLOP = 10;
const TAP_MS = 400;
const STOP_TAP_RADIUS = 24;
const FOCUS_RADIUS = 14;

class SceneBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Text labels over the canvas. Own state, so a camera move re-renders
 * this layer only -- not the toolbar, and not the three.js tree.
 */
function LabelLayer({ setterRef, onMount }) {
  const [labels, setLabels] = useState([]);
  useEffect(() => {
    setterRef.current = setLabels;
    onMount();
    return () => { setterRef.current = null; };
  }, [setterRef, onMount]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {labels.map((l) => (
        <View
          key={l.id}
          style={[
            styles.label,
            l.kind === 'stop' && styles.stopLabel,
            {
              left: l.x,
              top: l.y,
              borderColor: l.kind === 'zone' ? l.color : palette.path,
              backgroundColor: l.kind === 'stop'
                ? (l.next ? palette.selection : l.done ? palette.done : palette.path)
                : palette.labelBg,
            },
          ]}
        >
          <Text
            style={[styles.labelText, { color: l.kind === 'stop' ? palette.labelBg : palette.labelText }]}
            numberOfLines={1}
          >
            {l.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function Warehouse3DScreen({ navigation, route }) {
  const { t } = useLocale();
  const { warehouseId } = useAuth();
  const batchId = route.params?.batchId ?? null;
  const currentTaskId = route.params?.currentTaskId ?? null;

  const [mapData, setMapData] = useState(null);
  const [tasks, setTasks] = useState(route.params?.tasks || []);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState('status');
  const [query, setQuery] = useState('');
  const [selectedBinId, setSelectedBinId] = useState(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [batchLoaded, setBatchLoaded] = useState(!batchId);

  // ------------------------------------------------------------ data
  const load = useCallback(async () => {
    if (!warehouseId) {
      setLoading(false);
      setLoadError(t('map3d.loadFailed'));
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const resp = await client.get(`/api/warehouse-map?warehouse_id=${warehouseId}`, { timeout: 20000 });
      setMapData(resp.data || null);
    } catch (err) {
      setLoadError(err.response?.data?.error || t('map3d.loadFailed'));
    } finally {
      setLoading(false);
    }
    if (batchId) {
      // Fresh statuses for the route; the tasks passed in stay if this fails.
      client.get(`/api/picking/batch/${batchId}`)
        .then((resp) => { if (Array.isArray(resp.data?.tasks)) setTasks(resp.data.tasks); })
        .catch(() => {})
        .finally(() => setBatchLoaded(true));
    }
  }, [warehouseId, batchId, t]);

  useEffect(() => { load(); }, [load]);

  const bins = useMemo(() => mapData?.bins || [], [mapData]);
  const model = useMemo(() => buildSceneModel(mapData), [mapData]);
  const placements = useMemo(() => placeBins(model), [model]);
  const frames = useMemo(() => rackFrames(model), [model]);
  const placementById = useMemo(() => new Map(placements.map((p) => [p.bin_id, p])), [placements]);

  const matches = useMemo(() => scanMatches(bins, query), [bins, query]);
  const keys = useMemo(() => colorKeys(bins, mode), [bins, mode]);
  const binColors = useMemo(
    () => binColorMap(bins, keys, palette, matches?.binIds || null),
    [bins, keys, matches],
  );
  const matchPlacements = useMemo(
    () => (matches ? placements.filter((p) => matches.binIds.has(p.bin_id)) : []),
    [matches, placements],
  );

  const pickPath = useMemo(
    () => (batchId || tasks.length ? buildPickPath(tasksWithBinIds(tasks, bins), placements) : null),
    [batchId, tasks, bins, placements],
  );
  const nextIndex = useMemo(() => nextStopIndex(pickPath, currentTaskId), [pickPath, currentTaskId]);
  const nextStop = nextIndex >= 0 ? pickPath.stops[nextIndex] : null;
  const nextPlacement = nextStop ? placementById.get(nextStop.bin_id) || null : null;

  const selected = useMemo(() => bins.find((b) => b.bin_id === selectedBinId) || null, [bins, selectedBinId]);
  const selectedPlacement = selected ? placementById.get(selected.bin_id) || null : null;

  // ---------------------------------------------------------- camera
  const span = Math.max(model.floor.w, model.floor.h, 10);
  const maxRadius = span * 3;
  const presetOrbit = useCallback(
    (kind) => orbitFromPreset(cameraPreset(model.floor, kind)),
    [model.floor],
  );
  const orbitRef = useRef(null);
  const bridgeRef = useRef(null);
  const sizeRef = useRef(size);
  const labelDefsRef = useRef([]);
  const rafRef = useRef(null);
  const labelsRef = useRef([]);
  const labelSetterRef = useRef(null);

  const refreshLabels = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const { width, height } = sizeRef.current;
      if (!orbitRef.current || !width || !height) return;
      labelsRef.current = visibleLabels(labelDefsRef.current, orbitRef.current, width, height, MAX_LABELS);
      labelSetterRef.current?.(labelsRef.current);
    });
  }, []);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const applyOrbit = useCallback((orbit) => {
    const next = clampOrbit(orbit, maxRadius);
    orbitRef.current = next;
    const bridge = bridgeRef.current;
    if (bridge) {
      bridge.camera.position.set(...orbitPosition(next));
      bridge.camera.lookAt(...next.target);
      bridge.camera.updateMatrixWorld();
      bridge.invalidate();
    }
    refreshLabels();
  }, [maxRadius, refreshLabels]);

  const focusPlacement = useCallback((pl) => {
    const theta = orbitRef.current?.theta ?? presetOrbit('reset').theta;
    applyOrbit(orbitFocus([pl.x, pl.y, pl.z], FOCUS_RADIUS, theta));
  }, [applyOrbit, presetOrbit]);

  // First view once the map is in: the next pick stop in route mode,
  // otherwise the whole floor. Later reloads keep the user's camera.
  const framedRef = useRef(false);
  useEffect(() => {
    if (!mapData || framedRef.current) return;
    if (tasks.length === 0 && !batchLoaded) return; // route mode: wait for the batch
    framedRef.current = true;
    if (nextPlacement) focusPlacement(nextPlacement);
    else applyOrbit(presetOrbit('reset'));
  }, [mapData, tasks.length, batchLoaded, nextPlacement, focusPlacement, applyOrbit, presetOrbit]);

  const initialPosition = useMemo(() => orbitPosition(presetOrbit('reset')), [presetOrbit]);

  const onReady = useCallback((bridge) => {
    bridgeRef.current = bridge;
    // Before the first framing (route mode waits for its batch) show the
    // whole floor rather than r3f's default look at the origin.
    applyOrbit(orbitRef.current || presetOrbit('reset'));
  }, [applyOrbit, presetOrbit]);

  // ---------------------------------------------------------- labels
  useEffect(() => {
    const defs = model.zones.map((z) => ({
      id: `z${z.zone_id}`,
      kind: 'zone',
      text: z.code || z.label,
      point: [z.x + 0.4, 0.05, z.y + 0.4],
      color: z.color || palette.zoneFallback,
    }));
    (pickPath?.stops || []).forEach((s, i) => {
      defs.push({
        id: `s${s.index}`,
        kind: 'stop',
        text: String(s.index),
        point: s.marker,
        binId: s.bin_id,
        done: s.done,
        next: i === nextIndex,
        priority: i === nextIndex ? 3 : 2,
      });
    });
    if (selectedPlacement) {
      defs.push({
        id: 'sel',
        kind: 'bin',
        text: selected.bin_code,
        point: [selectedPlacement.x, selectedPlacement.top + 0.3, selectedPlacement.z],
        priority: 4,
      });
    }
    labelDefsRef.current = defs;
    refreshLabels();
  }, [model, pickPath, nextIndex, selected, selectedPlacement, refreshLabels]);

  // -------------------------------------------------------- gestures
  const placementsRef = useRef(placements);
  placementsRef.current = placements;

  const onTap = useCallback((x, y) => {
    const { width, height } = sizeRef.current;
    if (!orbitRef.current || !width) return;
    const stop = labelsRef.current.find((l) => (
      l.kind === 'stop' && Math.hypot(l.x - x, l.y - y) <= STOP_TAP_RADIUS
    ));
    if (stop) {
      setSelectedBinId(stop.binId);
      return;
    }
    const hit = pickPlacement(placementsRef.current, screenRay(x, y, orbitRef.current, width, height));
    setSelectedBinId(hit ? hit.bin_id : null);
  }, []);

  const gesture = useRef({ count: 0 });
  const handlersRef = useRef({});
  handlersRef.current = { applyOrbit, onTap };

  const responder = useMemo(() => {
    const g = gesture.current;
    const reset = (touches) => {
      g.count = touches.length;
      if (touches.length >= 2) {
        const [a, b] = touches;
        g.dist = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) || 1;
        g.cx = (a.pageX + b.pageX) / 2;
        g.cy = (a.pageY + b.pageY) / 2;
      } else if (touches.length === 1) {
        g.x = touches[0].pageX;
        g.y = touches[0].pageY;
      }
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const touches = e.nativeEvent.touches || [];
        reset(touches);
        g.startX = e.nativeEvent.locationX;
        g.startY = e.nativeEvent.locationY;
        g.startT = Date.now();
        g.moved = 0;
        g.multi = touches.length > 1;
      },
      onPanResponderMove: (e) => {
        const touches = e.nativeEvent.touches || [];
        const orbit = orbitRef.current;
        if (!orbit || !touches.length) return;
        const n = touches.length >= 2 ? 2 : 1;
        if (n !== g.count) {
          // Finger added or lifted: re-anchor so the view does not jump.
          reset(touches);
          if (n === 2) g.multi = true;
          return;
        }
        if (n === 2) {
          const [a, b] = touches;
          const dist = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) || 1;
          const cx = (a.pageX + b.pageX) / 2;
          const cy = (a.pageY + b.pageY) / 2;
          let next = zoomOrbit(orbit, dist / g.dist, maxRadius);
          next = panOrbit(next, cx - g.cx, cy - g.cy, sizeRef.current.height);
          g.dist = dist;
          g.cx = cx;
          g.cy = cy;
          handlersRef.current.applyOrbit(next);
        } else {
          const dx = touches[0].pageX - g.x;
          const dy = touches[0].pageY - g.y;
          g.x = touches[0].pageX;
          g.y = touches[0].pageY;
          g.moved += Math.abs(dx) + Math.abs(dy);
          if (g.moved > TAP_SLOP) handlersRef.current.applyOrbit(rotateOrbit(orbit, dx, dy));
        }
      },
      onPanResponderRelease: () => {
        if (!g.multi && g.moved <= TAP_SLOP && Date.now() - g.startT < TAP_MS) {
          handlersRef.current.onTap(g.startX, g.startY);
        }
        g.count = 0;
      },
      onPanResponderTerminate: () => { g.count = 0; },
    });
  }, [maxRadius]);

  const onLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    sizeRef.current = { width, height };
    setSize({ width, height });
    refreshLabels();
  }, [refreshLabels]);

  // ---------------------------------------------------------- search
  const onScan = useCallback((code) => {
    setQuery(code);
    const found = scanMatches(bins, code);
    if (found && found.count === 1) {
      const [binId] = [...found.binIds];
      setSelectedBinId(binId);
      const pl = placementById.get(binId);
      if (pl) focusPlacement(pl);
    } else {
      setSelectedBinId(null);
    }
  }, [bins, placementById, focusPlacement]);

  // ---------------------------------------------------------- render
  const title = batchId ? t('map3d.titlePick') : t('map3d.title');
  const pickDone = pickPath && pickPath.stops.length > 0 && nextIndex === -1;
  const q = RENDER_SCALE;
  const canvasBox = q < 1 && size.width > 0
    ? {
      position: 'absolute',
      width: size.width * q,
      height: size.height * q,
      left: (size.width - size.width * q) / 2,
      top: (size.height - size.height * q) / 2,
      transform: [{ scale: 1 / q }],
    }
    : StyleSheet.absoluteFillObject;

  const stock = selected ? binStockView(selected) : null;

  return (
    <View style={screenStyles.screen}>
      <ScreenHeader title={title} onBack={() => navigation.goBack()} />

      <View style={styles.toolbar}>
        <ScanInput placeholder={t('map3d.searchPlaceholder')} onScan={onScan} />
        {query ? (
          <View style={styles.searchRow}>
            <Text style={styles.searchQuery} numberOfLines={1}>{query}</Text>
            <Text style={styles.searchCount}>
              {matches && matches.count > 0
                ? t('map3d.matches', { count: matches.count })
                : t('map3d.noMatches')}
            </Text>
            <TouchableOpacity style={styles.clearBtn} onPress={() => setQuery('')}>
              <Text style={styles.clearText}>{t('map3d.clear')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={styles.modeRow}>
          {COLOR_MODES.map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.modeChip, mode === m && styles.modeChipActive]}
              onPress={() => setMode(m)}
            >
              <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{t(MODE_LABELS[m])}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.legendRow}>
          {LEGENDS[mode].map(([key, labelKey]) => (
            <View key={key} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: palette[key] }]} />
              <Text style={styles.legendText}>{t(labelKey)}</Text>
            </View>
          ))}
        </View>
        {pickPath ? (
          <Text style={styles.routeInfo}>
            {pickDone
              ? t('map3d.routeDone')
              : nextStop
                ? t('map3d.routeNext', { n: nextStop.index, total: pickPath.stops.length, bin: nextStop.bin_code })
                : t('map3d.routeEmpty')}
            {pickPath.missing > 0 ? t('map3d.routeMissing', { count: pickPath.missing }) : ''}
          </Text>
        ) : null}
      </View>

      <View style={styles.sceneWrap} onLayout={onLayout}>
        {loading && !mapData ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : loadError ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{loadError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>{t('map3d.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : bins.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>{t('map3d.empty')}</Text>
          </View>
        ) : (
          <>
            {size.width > 0 && (
              <SceneBoundary
                fallback={(
                  <View style={styles.center}>
                    <Text style={styles.errorText}>{t('map3d.glFailed')}</Text>
                  </View>
                )}
              >
                <View style={canvasBox} pointerEvents="none">
                  <WarehouseCanvas
                    model={model}
                    placements={placements}
                    frames={frames}
                    binColors={binColors}
                    matchPlacements={matchPlacements}
                    selectedPlacement={selectedPlacement}
                    pickPath={pickPath}
                    nextIndex={nextIndex}
                    nextPlacement={nextPlacement}
                    palette={palette}
                    initialPosition={initialPosition}
                    onReady={onReady}
                  />
                </View>
              </SceneBoundary>
            )}
            <View style={StyleSheet.absoluteFill} {...responder.panHandlers} />
            <LabelLayer setterRef={labelSetterRef} onMount={refreshLabels} />
            <View style={styles.viewButtons}>
              <TouchableOpacity style={styles.viewBtn} onPress={() => applyOrbit(presetOrbit('reset'))}>
                <Text style={styles.viewBtnText}>{t('map3d.resetView')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.viewBtn} onPress={() => applyOrbit(presetOrbit('top'))}>
                <Text style={styles.viewBtnText}>{t('map3d.topView')}</Text>
              </TouchableOpacity>
              {nextPlacement ? (
                <TouchableOpacity style={styles.viewBtn} onPress={() => focusPlacement(nextPlacement)}>
                  <Text style={styles.viewBtnText}>{t('map3d.nextStop')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {!selected ? (
              <View style={styles.hintWrap} pointerEvents="none">
                <Text style={styles.hint}>{t('map3d.hint')}</Text>
              </View>
            ) : null}
          </>
        )}

        {selected ? (
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>{selected.bin_code}</Text>
                <Text style={styles.sheetMeta}>
                  {t('map3d.binMeta', {
                    zone: selected.zone_name || selected.zone_code || '-',
                    slot: selected.slot_label || '-',
                    qty: selected.total_qty || 0,
                  })}
                </Text>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setSelectedBinId(null)}>
                <Text style={styles.closeText}>{t('map3d.close')}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetBody}>
              {stock.pallets.length === 0 && stock.unpalletized.length === 0 ? (
                <Text style={styles.sheetEmpty}>{t('map3d.binEmpty')}</Text>
              ) : null}
              {stock.pallets.length > 0 ? (
                <Text style={styles.sheetSection}>{t('map3d.pallets')}</Text>
              ) : null}
              {stock.pallets.map((p) => (
                <View key={`p${p.pallet_id}`} style={styles.row}>
                  <Text style={styles.rowTitle}>{p.pallet_code || p.pallet_id}</Text>
                  <Text style={styles.rowSub}>{[p.sku, p.item_name].filter(Boolean).join(' · ')}</Text>
                  <Text style={styles.rowMeta}>
                    {t('map3d.qty', { qty: p.quantity_on_hand ?? 0 })}
                    {p.lot_code ? t('map3d.lotSuffix', { lot: p.lot_code }) : ''}
                    {p.expiry_date ? t('map3d.expirySuffix', { date: p.expiry_date }) : ''}
                  </Text>
                </View>
              ))}
              {stock.unpalletized.length > 0 ? (
                <Text style={styles.sheetSection}>{t('map3d.items')}</Text>
              ) : null}
              {stock.unpalletized.map((c, i) => (
                <View key={`c${c.item_id}-${i}`} style={styles.row}>
                  <Text style={styles.rowTitle}>{c.sku}</Text>
                  <Text style={styles.rowSub}>{c.item_name}</Text>
                  <Text style={styles.rowMeta}>
                    {t('map3d.qty', { qty: c.quantity_on_hand ?? 0 })}
                    {c.lot_number ? t('map3d.lotSuffix', { lot: c.lot_number }) : ''}
                    {c.expiry_date ? t('map3d.expirySuffix', { date: c.expiry_date }) : ''}
                  </Text>
                </View>
              ))}
              <Text style={styles.readOnly}>{t('map3d.readOnly')}</Text>
            </ScrollView>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { paddingHorizontal: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginTop: -8, marginBottom: 8, gap: 8 },
  searchQuery: { flex: 1, fontFamily: fonts.mono, fontSize: 11, fontWeight: '700', color: colors.textPrimary },
  searchCount: { fontFamily: fonts.mono, fontSize: 11, color: colors.textMuted },
  clearBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.small, borderWidth: 1, borderColor: colors.cardBorder },
  clearText: { fontFamily: fonts.mono, fontSize: 10, fontWeight: '700', color: colors.textSecondary },
  modeRow: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  modeChip: {
    flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radii.small,
    borderWidth: 1, borderColor: colors.cardBorder, minHeight: 36,
  },
  modeChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  modeText: { fontFamily: fonts.mono, fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  modeTextActive: { color: colors.onAccent },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swatch: { width: 12, height: 12, borderRadius: 3, borderWidth: 1, borderColor: colors.cardBorder },
  legendText: { fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted },
  routeInfo: { fontFamily: fonts.mono, fontSize: 11, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 },
  sceneWrap: { flex: 1, overflow: 'hidden', borderTopWidth: 1, borderTopColor: colors.cardBorder },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontFamily: fonts.mono, fontSize: 12, color: colors.danger, textAlign: 'center', marginBottom: 12 },
  emptyText: { fontFamily: fonts.mono, fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  retryBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radii.button, borderWidth: 1.5, borderColor: colors.cardBorder },
  retryText: { fontFamily: fonts.mono, fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  label: {
    position: 'absolute', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, borderWidth: 1,
    transform: [{ translateX: -12 }, { translateY: -10 }], maxWidth: 140,
  },
  stopLabel: { minWidth: 24, alignItems: 'center', borderRadius: 12 },
  labelText: { fontFamily: fonts.mono, fontSize: 10, fontWeight: '700' },
  viewButtons: { position: 'absolute', right: 8, top: 8, gap: 6 },
  viewBtn: {
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: radii.small, minHeight: 36, justifyContent: 'center',
    borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.background,
  },
  viewBtnText: { fontFamily: fonts.mono, fontSize: 10, fontWeight: '700', color: colors.textPrimary },
  hintWrap: { position: 'absolute', left: 8, right: 8, bottom: 8 },
  hint: { textAlign: 'center', fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '55%',
    backgroundColor: colors.background, borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card,
    borderTopWidth: 1, borderColor: colors.cardBorder, paddingHorizontal: 14, paddingTop: 12,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  sheetTitle: { fontFamily: fonts.mono, fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  sheetMeta: { fontFamily: fonts.mono, fontSize: 11, color: colors.textMuted, marginTop: 2 },
  closeBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.small, borderWidth: 1.5, borderColor: colors.cardBorder },
  closeText: { fontFamily: fonts.mono, fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  sheetBody: { marginBottom: 8 },
  sheetEmpty: { fontFamily: fonts.mono, fontSize: 12, color: colors.textMuted, paddingVertical: 8 },
  sheetSection: { fontFamily: fonts.mono, fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginTop: 6, marginBottom: 4 },
  row: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  rowTitle: { fontFamily: fonts.mono, fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  rowSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  rowMeta: { fontFamily: fonts.mono, fontSize: 11, color: colors.textMuted, marginTop: 2 },
  readOnly: { fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted, marginTop: 10, marginBottom: 12 },
});
