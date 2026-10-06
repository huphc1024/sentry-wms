import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import { useLocale } from '../i18n/locale.jsx';
import { useAuth } from '../auth.jsx';
import PageHeader from '../components/PageHeader.jsx';
import BinDetailCard from '../components/simulation/BinDetailCard.jsx';
import AttachPalletModal from '../components/simulation/AttachPalletModal.jsx';
import WarehouseScene from './warehouse3d/WarehouseScene.jsx';
import { useScenePalette } from './warehouse3d/palette.js';
import LayoutEditor from './warehouse3d/LayoutEditor.jsx';
import { canEditLayout, draftToMapData } from './warehouse3d/layoutModel.js';
import {
  binColorMap,
  buildPickPath,
  buildSceneModel,
  colorKeys,
  COLOR_MODES,
  fillReference,
  placeBins,
  rackFrames,
  searchMatches,
} from './warehouse3d/model.js';

const LEGENDS = {
  status: [
    ['status-empty', 'warehouseSimulation.statusEmpty'],
    ['status-occupied', 'warehouseSimulation.statusOccupied'],
    ['status-expired', 'warehouseSimulation.statusExpiring'],
  ],
  fill: [
    ['fill0', 'warehouse3d.fill0'],
    ['fill1', 'warehouse3d.fill1'],
    ['fill2', 'warehouse3d.fill2'],
    ['fill3', 'warehouse3d.fill3'],
    ['fill4', 'warehouse3d.fill4'],
  ],
  expiry: [
    ['expiry-expired', 'warehouse3d.expiryExpired'],
    ['expiry-soon', 'warehouse3d.expirySoon'],
    ['expiry-ok', 'warehouse3d.expiryOk'],
    ['expiry-none', 'warehouse3d.expiryNone'],
  ],
};

const MODE_LABELS = {
  status: 'warehouse3d.modeStatus',
  fill: 'warehouse3d.modeFill',
  expiry: 'warehouse3d.modeExpiry',
};

const BATCH_STATUS_LABELS = {
  OPEN: 'warehouse3d.batchOpen',
  IN_PROGRESS: 'warehouse3d.batchInProgress',
  COMPLETED: 'warehouse3d.batchCompleted',
};

const MAX_RESULTS = 60;

export default function Warehouse3D() {
  const { warehouseId, warehouse } = useWarehouse();
  const { t } = useLocale();
  const palette = useScenePalette();
  const [mapData, setMapData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState('');
  const [mode, setMode] = useState('status');
  const [search, setSearch] = useState('');
  const [selectedBinId, setSelectedBinId] = useState(null);
  const [selectedPallet, setSelectedPallet] = useState(null);
  const [attachRow, setAttachRow] = useState(null);
  const [hover, setHover] = useState(null);
  const [viewCommand, setViewCommand] = useState({ kind: 'reset', nonce: 0 });
  const auth = useAuth();
  const canEdit = canEditLayout(auth?.user);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [mapVersion, setMapVersion] = useState(0);
  const [notice, setNotice] = useState('');

  const loadMap = useCallback(async () => {
    if (!warehouseId) return;
    setLoading(true);
    setError('');
    const res = await api.get(`/admin/warehouse-map?warehouse_id=${warehouseId}`);
    if (!res?.ok) {
      setLoading(false);
      const data = await res?.json().catch(() => ({}));
      setError(data?.error || t('warehouseSimulation.loadError'));
      return;
    }
    setMapData(await res.json());
    setMapVersion((v) => v + 1);
    const pick = await api.get(
      `/admin/warehouse-map/pick-paths?warehouse_id=${warehouseId}`,
      { silentPermissionDenied: true },
    );
    setLoading(false);
    if (pick?.ok) {
      const body = await pick.json();
      setBatches(Array.isArray(body?.batches) ? body.batches : []);
    } else {
      setBatches([]);
    }
  }, [warehouseId, t]);

  useEffect(() => { loadMap(); }, [loadMap]);

  const bins = useMemo(() => mapData?.bins || [], [mapData]);
  // While editing, the 3D view draws the draft so it follows every move.
  const sceneMap = useMemo(
    () => (editing && draft ? draftToMapData(mapData, draft) : mapData),
    [editing, draft, mapData],
  );
  const model = useMemo(() => buildSceneModel(sceneMap), [sceneMap]);
  const placements = useMemo(() => placeBins(model), [model]);
  const frames = useMemo(() => rackFrames(model), [model]);
  const placementById = useMemo(
    () => new Map(placements.map((p) => [p.bin_id, p])),
    [placements],
  );

  const query = search.trim();
  const matches = useMemo(
    () => (query ? searchMatches(bins, query) : null),
    [bins, query],
  );
  const keys = useMemo(() => colorKeys(bins, mode), [bins, mode]);
  const binColors = useMemo(
    () => binColorMap(bins, keys, palette, matches?.binIds || null),
    [bins, keys, palette, matches],
  );
  const matchPlacements = useMemo(
    () => (matches ? placements.filter((p) => matches.binIds.has(p.bin_id)) : []),
    [matches, placements],
  );
  const matchBins = useMemo(
    () => (matches ? bins.filter((b) => matches.binIds.has(b.bin_id)) : []),
    [matches, bins],
  );

  const batch = batches.find((b) => String(b.batch_id) === String(batchId)) || null;
  const pickPath = useMemo(
    () => (batch ? buildPickPath(batch.tasks, placements) : null),
    [batch, placements],
  );

  const selected = bins.find((b) => b.bin_id === selectedBinId) || null;
  const hovered = hover ? bins.find((b) => b.bin_id === hover.binId) : null;
  const fillRef = useMemo(() => fillReference(bins), [bins]);

  const selectBin = useCallback((binId) => {
    setSelectedBinId(binId);
    setSelectedPallet(null);
  }, []);

  const onHoverBin = useCallback((binId, ev) => {
    if (binId == null) {
      setHover(null);
      return;
    }
    setHover({ binId, x: ev?.offsetX ?? 0, y: ev?.offsetY ?? 0 });
  }, []);

  const onPalletAttached = async (palletId) => {
    const binId = selected?.bin_id;
    setAttachRow(null);
    await loadMap();
    if (binId != null) {
      setSelectedBinId(binId);
      setSelectedPallet(palletId);
    }
  };

  const startEditing = () => {
    setNotice('');
    setSelectedBinId(null);
    setDraft(null);
    setEditing(true);
  };

  const stopEditing = () => {
    setEditing(false);
    setDraft(null);
  };

  const onLayoutSaved = async (body) => {
    stopEditing();
    setNotice(t('warehouse3d.layoutSaved', { version: body?.version ?? '' }));
    await loadMap();
  };

  const title = warehouse?.warehouse_name || mapData?.warehouse_name || mapData?.warehouse_code || '';

  return (
    <div className="warehouse-simulation-page warehouse-3d-page">
      <PageHeader title={t('warehouse3d.title', { warehouse: title })}>
        <Link className="btn" to="/warehouse-simulation">{t('warehouse3d.open2d')}</Link>
        {canEdit && mapData && !editing && (
          <button type="button" className="btn" onClick={startEditing} disabled={loading}>
            {t('warehouse3d.editLayout')}
          </button>
        )}
        <button type="button" className="btn" onClick={loadMap} disabled={loading || editing}>
          {loading ? t('warehouseSimulation.loading') : t('warehouseSimulation.refresh')}
        </button>
      </PageHeader>

      {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
      {notice && <div className="wh3d-ed-ok wh3d-ed-message" role="status">{notice}</div>}
      {!warehouseId && <p style={{ color: 'var(--text-secondary)' }}>{t('warehouseSimulation.selectWarehouse')}</p>}

      {mapData && (
        <>
          <div className="wh3d-toolbar">
            <div className="wh3d-search">
              <input
                className="form-input wh3d-search-input"
                aria-label={t('warehouse3d.searchLabel')}
                placeholder={t('warehouse3d.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {query && (
                <>
                  <span className="wh3d-count" data-testid="wh3d-match-count">
                    {matchBins.length
                      ? t('warehouse3d.matchCount', { bins: matchBins.length })
                      : t('warehouse3d.noMatches')}
                  </span>
                  <button type="button" className="btn" onClick={() => setSearch('')}>
                    {t('warehouse3d.clearSearch')}
                  </button>
                </>
              )}
            </div>
            <div className="wh3d-group" role="group" aria-label={t('warehouse3d.colorBy')}>
              <span className="wh3d-group-label">{t('warehouse3d.colorBy')}</span>
              {COLOR_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`btn${mode === m ? ' btn-primary' : ''}`}
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                >
                  {t(MODE_LABELS[m])}
                </button>
              ))}
            </div>
            <div className="wh3d-group">
              <button type="button" className="btn" onClick={() => setViewCommand((c) => ({ kind: 'reset', nonce: c.nonce + 1 }))}>
                {t('warehouse3d.resetView')}
              </button>
              <button type="button" className="btn" onClick={() => setViewCommand((c) => ({ kind: 'top', nonce: c.nonce + 1 }))}>
                {t('warehouse3d.topView')}
              </button>
            </div>
            <div className="wh3d-group">
              <label className="wh3d-group-label" htmlFor="wh3d-batch">{t('warehouse3d.pickRoute')}</label>
              <select
                id="wh3d-batch"
                className="form-select"
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
              >
                <option value="">{batches.length ? t('warehouse3d.pickRouteNone') : t('warehouse3d.noBatches')}</option>
                {batches.map((b) => (
                  <option key={b.batch_id} value={String(b.batch_id)}>
                    {t('warehouse3d.batchOption', {
                      batch: b.batch_number,
                      status: BATCH_STATUS_LABELS[b.status] ? t(BATCH_STATUS_LABELS[b.status]) : b.status,
                      orders: (b.orders || []).length,
                    })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="sim2-legend-bar wh3d-legend" aria-label={t('warehouseSimulation.legend')}>
            <div className="sim2-legend-bar-group">
              {LEGENDS[mode].map(([key, label]) => (
                <span key={key} className="sim2-legend-item">
                  <span className="wh3d-swatch" style={{ background: palette[key] }} />
                  {t(label)}
                </span>
              ))}
            </div>
            <span className="sim2-context-note">
              {mode === 'fill' && t('warehouse3d.fillHint', { qty: fillRef })}
              {mode !== 'fill' && model.source === 'auto' && t('warehouse3d.autoLayoutNote')}
            </span>
          </div>

          <div className={`wh3d-main${editing ? ' is-editing' : ''}`}>
            {editing && (
              <LayoutEditor
                key={mapVersion}
                mapData={mapData}
                warehouseId={warehouseId}
                onDraftChange={setDraft}
                onSaved={onLayoutSaved}
                onCancel={stopEditing}
                onReload={loadMap}
              />
            )}
            <div className="wh3d-canvas" data-testid="wh3d-canvas" aria-label={editing ? t('warehouse3d.editingPreview') : undefined}>
              <WarehouseScene
                model={model}
                placements={placements}
                frames={frames}
                binColors={binColors}
                matchPlacements={matchPlacements}
                selectedPlacement={selectedBinId != null ? placementById.get(selectedBinId) : null}
                pickPath={pickPath}
                palette={palette}
                viewCommand={viewCommand}
                onHoverBin={onHoverBin}
                onSelectBin={selectBin}
                ariaLabel={t('warehouse3d.canvasLabel')}
                fallback={<div className="wh3d-fallback">{t('warehouse3d.noWebgl')}</div>}
              />
              {hovered && (
                <div className="wh3d-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="tooltip">
                  <strong>{hovered.bin_code}</strong>
                  <span>{t('warehouse3d.tooltipQty', { qty: Number(hovered.total_qty || 0) })}</span>
                </div>
              )}
              <div className="wh3d-stats">
                {t('warehouse3d.stats', { bins: placements.length, racks: model.racks.length })}
              </div>
            </div>

            {!editing && (
            <aside className="wh3d-side">
              {selected ? (
                <BinDetailCard
                  bin={selected}
                  selectedPallet={selectedPallet}
                  onSelectPallet={setSelectedPallet}
                  onAttachPallet={(row) => setAttachRow(row)}
                >
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <Link className="btn btn-sm" to="/warehouse-simulation">{t('warehouse3d.open2d')}</Link>
                    <button type="button" className="btn btn-sm" onClick={() => selectBin(null)}>{t('common.close')}</button>
                  </div>
                </BinDetailCard>
              ) : (
                <div className="sim2-detail-card wh3d-hint">{t('warehouse3d.detailHint')}</div>
              )}

              {pickPath && (
                <div className="sim2-detail-card">
                  <div className="sim2-pallet-list-title">
                    {t('warehouse3d.stopsSummary', {
                      stops: pickPath.stops.length,
                      done: pickPath.stops.filter((s) => s.done).length,
                    })}
                  </div>
                  {pickPath.missing > 0 && (
                    <div className="sim2-empty-hint">{t('warehouse3d.missingStops', { count: pickPath.missing })}</div>
                  )}
                  <ol className="wh3d-list">
                    {pickPath.stops.map((s) => (
                      <li key={`${s.index}-${s.bin_id}`}>
                        <button
                          type="button"
                          className={`wh3d-list-item${s.done ? ' is-done' : ''}${selectedBinId === s.bin_id ? ' is-active' : ''}`}
                          onClick={() => selectBin(s.bin_id)}
                        >
                          <span className="wh3d-stop-index">{s.index}</span>
                          <strong>{s.bin_code}</strong>
                          <span>
                            {s.tasks.map((task) => task.sku).filter(Boolean).join(', ')}
                            {' · '}
                            {t('warehouse3d.stopQty', { qty: s.quantity })}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {query && matchBins.length > 0 && (
                <div className="sim2-detail-card">
                  <div className="sim2-pallet-list-title">{t('warehouse3d.searchResults')}</div>
                  <ul className="wh3d-list">
                    {matchBins.slice(0, MAX_RESULTS).map((b) => (
                      <li key={b.bin_id}>
                        <button
                          type="button"
                          className={`wh3d-list-item${selectedBinId === b.bin_id ? ' is-active' : ''}`}
                          onClick={() => selectBin(b.bin_id)}
                        >
                          <strong>{b.bin_code}</strong>
                          <span>{t('warehouse3d.tooltipQty', { qty: Number(b.total_qty || 0) })}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>
            )}
          </div>
        </>
      )}

      {attachRow && selected && (
        <AttachPalletModal
          bin={selected}
          row={attachRow}
          warehouseId={warehouseId}
          onClose={() => setAttachRow(null)}
          onAttached={onPalletAttached}
        />
      )}
    </div>
  );
}
