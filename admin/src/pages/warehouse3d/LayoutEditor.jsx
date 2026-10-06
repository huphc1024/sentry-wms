import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useLocale } from '../../i18n/locale.jsx';
import { useDirtyFormGuard } from '../../hooks/useDirtyFormGuard.js';
import {
  buildDraft,
  buildPayload,
  findItem,
  footprint,
  historyInit,
  historyPush,
  historyRedo,
  historyReplace,
  historyUndo,
  issueTargets,
  localIssues,
  moveItem,
  resizeRect,
  rotateItem,
  round3,
  sameDraft,
  setBounds,
  setField,
  updateItem,
} from './layoutModel.js';

const HANDLES = ['nw', 'ne', 'sw', 'se'];

const FIELD_LABELS = {
  x: 'warehouse3d.fieldX',
  y: 'warehouse3d.fieldY',
  w: 'warehouse3d.fieldWidth',
  h: 'warehouse3d.fieldHeight',
};

const ISSUE_KEYS = {
  zone_not_in_warehouse: 'warehouse3d.issueZoneForeign',
  zone_outside_bounds: 'warehouse3d.issueZoneOutside',
  zone_beyond_bounds: 'warehouse3d.issueZoneOutside',
  rack_not_in_warehouse: 'warehouse3d.issueRackForeign',
  rack_outside_bounds: 'warehouse3d.issueRackOutside',
  rack_beyond_bounds: 'warehouse3d.issueRackOutside',
  rack_unknown_zone: 'warehouse3d.issueRackUnknownZone',
  rack_outside_zone: 'warehouse3d.issueRackOutsideZone',
  racks_overlap: 'warehouse3d.issueRacksOverlap',
  path_not_in_warehouse: 'warehouse3d.issuePathForeign',
  path_outside_bounds: 'warehouse3d.issuePathOutside',
  pedestrian_path_narrow: 'warehouse3d.issuePedestrianNarrow',
  forklift_path_narrow: 'warehouse3d.issueForkliftNarrow',
  path_crosses_rack: 'warehouse3d.issuePathCrossesRack',
  paths_intersect: 'warehouse3d.issuePathsIntersect',
};

/**
 * Ask before an in-app link takes the user away from unsaved edits.
 *
 * The admin router is the declarative <BrowserRouter>, which has no
 * navigation blocker (see useDirtyFormGuard). A capturing click listener
 * on the document runs before react-router's own handler, so a declined
 * confirm stops sidebar and page links alike.
 */
function useLeaveGuard(active, message) {
  useEffect(() => {
    if (!active) return undefined;
    function onClick(e) {
      const link = e.target?.closest?.('a[href]');
      if (!link || link.target === '_blank') return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active, message]);
}

/** Numeric input that commits on blur or Enter, so typing "1." is not fought. */
function NumberField({
  label, value, onCommit, step, min, testId,
}) {
  const shown = Number.isFinite(value) ? String(round3(value)) : '';
  const [text, setText] = useState(shown);
  // Follow outside changes (drag, undo) without an effect.
  const [lastShown, setLastShown] = useState(shown);
  if (shown !== lastShown) {
    setLastShown(shown);
    setText(shown);
  }
  const commit = () => {
    const v = Number(text);
    if (text.trim() === '' || !Number.isFinite(v)) {
      setText(shown);
      return;
    }
    if (v !== round3(value)) onCommit(v);
  };
  return (
    <label className="wh3d-ed-field">
      <span>{label}</span>
      <input
        type="number"
        className="form-input"
        step={step}
        min={min}
        value={text}
        data-testid={testId}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          e.stopPropagation();
        }}
      />
    </label>
  );
}

function viewBoxFor(draft) {
  const rects = [
    draft.bounds,
    ...draft.zones,
    ...draft.racks.map(footprint),
  ];
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  const pad = Math.max(2, Math.max(x2 - x1, y2 - y1) * 0.04);
  return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
}

/**
 * Top-down floor-plan editor for zones and racks (SVG + pointer events).
 *
 * Owns the draft and its undo history; reports every change through
 * `onDraftChange` so the 3D preview beside it follows live. Saving goes
 * to PUT /api/admin/warehouse-map/layout with the version the draft was
 * built from; a 409 offers to reload the latest layout.
 */
export default function LayoutEditor({
  mapData, warehouseId, onDraftChange, onSaved, onCancel, onReload,
}) {
  const { t } = useLocale();
  const initial = useMemo(() => buildDraft(mapData), [mapData]);
  const [history, setHistory] = useState(() => historyInit(initial));
  const [sel, setSel] = useState(null);
  const [withRacks, setWithRacks] = useState(true);
  const [serverResult, setServerResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [conflict, setConflict] = useState(false);
  const svgRef = useRef(null);
  const dragRef = useRef(null);

  const draft = history.present;
  const dirty = !sameDraft(draft, initial);
  const canSave = dirty || draft.source === 'auto';

  useEffect(() => { onDraftChange?.(draft); }, [draft, onDraftChange]);
  useDirtyFormGuard(dirty);
  useLeaveGuard(dirty, t('warehouse3d.discardConfirm'));

  // The view box follows the warehouse bounds, not the items in flight,
  // so the plan does not rescale under the pointer mid-drag.
  const viewBox = useMemo(
    () => viewBoxFor({ ...initial, bounds: draft.bounds }),
    [initial, draft.bounds],
  );

  const live = serverResult && serverResult.draft === draft ? null : localIssues(draft);
  const issues = live || serverResult.issues;
  const targets = useMemo(() => issueTargets(issues), [issues]);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.length - errorCount;

  const selected = findItem(draft, sel);
  const rackByKey = useMemo(() => new Map(draft.racks.map((r) => [r.rack_key, r])), [draft.racks]);
  const zoneById = useMemo(() => new Map(draft.zones.map((z) => [z.zone_id, z])), [draft.zones]);

  const commit = useCallback((fn) => {
    setHistory((h) => historyPush(h, fn(h.present)));
  }, []);

  // ------------------------------------------------------------ pointer

  const metersPerPixel = () => {
    const rect = svgRef.current?.getBoundingClientRect?.();
    if (!rect || !rect.width || !rect.height) return 1;
    return Math.max(viewBox.w / rect.width, viewBox.h / rect.height);
  };

  // One delegated handler: zones, racks and handles carry data-drag /
  // data-kind / data-id / data-handle; a press on empty floor deselects.
  const onPlanPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    const el = e.target?.closest?.('[data-drag]');
    if (!el) {
      setSel(null);
      return;
    }
    const mode = el.dataset.drag;
    const kind = el.dataset.kind;
    const target = mode === 'resize'
      ? sel
      : { kind, id: kind === 'zone' ? Number(el.dataset.id) : el.dataset.id };
    if (!target) return;
    e.preventDefault?.();
    setSel(target);
    svgRef.current?.focus?.();
    try { svgRef.current?.setPointerCapture?.(e.pointerId); } catch { /* jsdom / no capture */ }
    dragRef.current = {
      mode, target, handle: el.dataset.handle, x: e.clientX, y: e.clientY, scale: metersPerPixel(), before: draft,
    };
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.x) * d.scale;
    const dy = (e.clientY - d.y) * d.scale;
    let next;
    if (d.mode === 'move') {
      next = moveItem(d.before, d.target, dx, dy, { withRacks });
    } else {
      const item = findItem(d.before, d.target);
      next = updateItem(d.before, d.target, resizeRect(item, d.handle, dx, dy, { step: d.before.grid }));
    }
    setHistory((h) => historyReplace(h, next));
  };

  const endDrag = (e) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    try { svgRef.current?.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    setHistory((h) => historyPush({ ...h, present: d.before }, h.present, d.before));
  };

  // ------------------------------------------------------------ keyboard

  const onKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      setHistory((h) => (e.shiftKey ? historyRedo(h) : historyUndo(h)));
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      setHistory(historyRedo);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Zones and racks are not deleted from the floor plan.
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      setSel(null);
      return;
    }
    const dirs = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    if (sel && dirs[e.key]) {
      e.preventDefault();
      const step = draft.grid * (e.shiftKey ? 4 : 1);
      const [ux, uy] = dirs[e.key];
      commit((d) => moveItem(d, sel, ux * step, uy * step, { withRacks }));
    }
  };

  // ------------------------------------------------------------ server

  const validate = async () => {
    setBusy(true);
    setMessage(null);
    const snapshot = draft;
    const res = await api.post(
      `/admin/warehouse-map/layout/validate?warehouse_id=${warehouseId}`,
      buildPayload(snapshot),
    );
    setBusy(false);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok) {
      setMessage({ kind: 'error', text: body?.error || t('warehouse3d.validateFailed') });
      return;
    }
    const list = Array.isArray(body.issues) ? body.issues : [
      // An API without structured issues: show its plain messages.
      ...(body.errors || []).map((message) => ({ severity: 'error', code: 'server_message', message })),
      ...(body.warnings || []).map((message) => ({ severity: 'warning', code: 'server_message', message })),
    ];
    setServerResult({ draft: snapshot, issues: list });
    const errors = list.filter((i) => i.severity === 'error').length;
    setMessage(errors
      ? { kind: 'error', text: t('warehouse3d.validateErrors', { errors, warnings: list.length - errors }) }
      : { kind: 'ok', text: t('warehouse3d.validateOk', { warnings: list.length }) });
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    setConflict(false);
    const snapshot = draft;
    const res = await api.put(
      `/admin/warehouse-map/layout?warehouse_id=${warehouseId}`,
      buildPayload(snapshot),
    );
    setBusy(false);
    const body = await res?.json().catch(() => ({}));
    if (res?.ok) {
      onSaved?.(body);
      return;
    }
    if (res?.status === 409) {
      setConflict(true);
      setMessage({ kind: 'error', text: t('warehouse3d.saveConflict') });
      return;
    }
    if (res?.status === 403) {
      setMessage({ kind: 'error', text: t('warehouse3d.saveForbidden') });
      return;
    }
    if (Array.isArray(body?.issues)) {
      setServerResult({ draft: snapshot, issues: body.issues });
      setMessage({ kind: 'error', text: t('warehouse3d.saveHasErrors') });
      return;
    }
    setMessage({ kind: 'error', text: body?.error || t('warehouse3d.saveFailed') });
  };

  const cancel = () => {
    if (dirty && !window.confirm(t('warehouse3d.discardConfirm'))) return;
    onCancel?.();
  };

  const reload = () => {
    if (dirty && !window.confirm(t('warehouse3d.discardConfirm'))) return;
    onReload?.();
  };

  // ------------------------------------------------------------ render

  const describe = (issue) => {
    const keys = issue.rack_keys || [];
    const rackName = (k) => rackByKey.get(k)?.label || k;
    const zone = zoneById.get((issue.zone_ids || [])[0]);
    const key = ISSUE_KEYS[issue.code];
    if (!key) return issue.message || issue.code;
    return t(key, {
      rack: keys[0] != null ? rackName(keys[0]) : '',
      rack2: keys[1] != null ? rackName(keys[1]) : '',
      zone: zone ? zone.label : String((issue.zone_ids || [])[0] ?? ''),
      path: issue.path || '',
    });
  };

  const focusIssue = (issue) => {
    const rk = (issue.rack_keys || [])[0];
    if (rk != null && rackByKey.has(rk)) {
      setSel({ kind: 'rack', id: rackByKey.get(rk).id });
      return;
    }
    const zid = (issue.zone_ids || [])[0];
    if (zid != null && zoneById.has(zid)) setSel({ kind: 'zone', id: zid });
  };

  const fontSize = Math.min(2, Math.max(0.35, viewBox.w / 80));
  const handleSize = Math.max(0.3, viewBox.w / 90);
  const step = draft.grid;
  const gridCell = step >= 1 ? step : Math.max(1, step * 4);

  const handlesFor = (r) => HANDLES.map((hd) => (
    <rect
      key={hd}
      data-testid={`handle-${hd}`}
      className="wh3d-ed-handle"
      x={(hd.includes('e') ? r.x + r.w : r.x) - handleSize / 2}
      y={(hd.includes('s') ? r.y + r.h : r.y) - handleSize / 2}
      width={handleSize}
      height={handleSize}
      data-drag="resize"
      data-handle={hd}
    />
  ));

  const itemClass = (base, isSel, err, warn) => [
    base,
    isSel ? 'is-selected' : '',
    err ? 'has-error' : '',
    !err && warn ? 'has-warning' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="wh3d-editor" data-testid="layout-editor">
      <div className="wh3d-ed-toolbar">
        <button type="button" className="btn" onClick={() => setHistory(historyUndo)} disabled={!history.past.length || busy}>
          {t('warehouse3d.undo')}
        </button>
        <button type="button" className="btn" onClick={() => setHistory(historyRedo)} disabled={!history.future.length || busy}>
          {t('warehouse3d.redo')}
        </button>
        <button type="button" className="btn" onClick={validate} disabled={busy}>
          {t('warehouse3d.validate')}
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !canSave}>
          {busy ? t('warehouse3d.saving') : t('warehouse3d.saveLayout')}
        </button>
        <button type="button" className="btn" onClick={cancel} disabled={busy}>
          {t('warehouse3d.cancelEdit')}
        </button>
        <label className="wh3d-ed-check">
          <input type="checkbox" checked={withRacks} onChange={(e) => setWithRacks(e.target.checked)} />
          {t('warehouse3d.moveRacksWithZone')}
        </label>
        <span className="wh3d-ed-status" data-testid="layout-dirty">
          {dirty ? t('warehouse3d.unsavedChanges') : t('warehouse3d.noChanges')}
        </span>
      </div>

      {draft.source === 'auto' && (
        <div className="sim2-context-note wh3d-ed-note">{t('warehouse3d.editFromAuto')}</div>
      )}

      {message && (
        <div className={message.kind === 'error' ? 'form-error wh3d-ed-message' : 'wh3d-ed-ok wh3d-ed-message'} role="status">
          {message.text}
          {conflict && (
            <button type="button" className="btn btn-sm" onClick={reload} style={{ marginLeft: 8 }}>
              {t('warehouse3d.reloadLatest')}
            </button>
          )}
        </div>
      )}

      <div className="wh3d-ed-body">
        <svg
          ref={svgRef}
          className="wh3d-ed-plan"
          data-testid="layout-plan"
          role="application"
          aria-label={t('warehouse3d.planLabel')}
          tabIndex={0}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerDown={onPlanPointerDown}
          onKeyDown={onKeyDown}
        >
          <defs>
            <pattern id="wh3d-ed-grid" width={gridCell} height={gridCell} patternUnits="userSpaceOnUse">
              <path d={`M ${gridCell} 0 L 0 0 0 ${gridCell}`} className="wh3d-ed-gridline" />
            </pattern>
          </defs>
          <rect
            className="wh3d-ed-floor"
            data-testid="layout-floor"
            x={draft.bounds.x}
            y={draft.bounds.y}
            width={draft.bounds.w}
            height={draft.bounds.h}
          />
          <rect
            x={draft.bounds.x}
            y={draft.bounds.y}
            width={draft.bounds.w}
            height={draft.bounds.h}
            fill="url(#wh3d-ed-grid)"
            pointerEvents="none"
          />

          {draft.zones.map((z) => {
            const isSel = sel?.kind === 'zone' && sel.id === z.zone_id;
            return (
              <g key={`z-${z.zone_id}`}>
                <rect
                  data-testid={`zone-${z.zone_id}`}
                  className={itemClass('wh3d-ed-zone', isSel, targets.errorZones.has(z.zone_id), targets.warnZones.has(z.zone_id))}
                  x={z.x}
                  y={z.y}
                  width={z.w}
                  height={z.h}
                  style={{ '--zone-color': z.color }}
                  data-drag="move"
                  data-kind="zone"
                  data-id={z.zone_id}
                />
                <text className="wh3d-ed-zone-label" x={z.x + 0.3} y={z.y + fontSize * 1.1} fontSize={fontSize}>
                  {z.code || z.label}
                </text>
              </g>
            );
          })}

          {draft.racks.map((r) => {
            const isSel = sel?.kind === 'rack' && sel.id === r.id;
            const cx = r.x + r.w / 2;
            const cy = r.y + r.h / 2;
            return (
              <g key={`r-${r.id}`} transform={`rotate(${r.rotationDeg} ${cx} ${cy})`}>
                <rect
                  data-testid={`rack-${r.id}`}
                  className={itemClass('wh3d-ed-rack', isSel, targets.errorRacks.has(r.rack_key), targets.warnRacks.has(r.rack_key))}
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  data-drag="move"
                  data-kind="rack"
                  data-id={r.id}
                />
                {isSel && handlesFor(r)}
              </g>
            );
          })}

          {selected && sel.kind === 'zone' && handlesFor(selected)}
        </svg>

        <aside className="wh3d-ed-props">
          <div className="sim2-detail-card">
            <div className="sim2-pallet-list-title">{t('warehouse3d.boundsTitle')}</div>
            <div className="wh3d-ed-grid2">
              <NumberField
                label={t('warehouse3d.fieldWidth')}
                value={draft.bounds.w}
                step={step}
                min={1}
                testId="bounds-w"
                onCommit={(v) => commit((d) => setBounds(d, 'w', v))}
              />
              <NumberField
                label={t('warehouse3d.fieldHeight')}
                value={draft.bounds.h}
                step={step}
                min={1}
                testId="bounds-h"
                onCommit={(v) => commit((d) => setBounds(d, 'h', v))}
              />
            </div>
            <div className="wh3d-ed-hint">{t('warehouse3d.gridStep', { step })}</div>
          </div>

          <div className="sim2-detail-card" data-testid="layout-props">
            {selected ? (
              <>
                <div className="sim2-pallet-list-title">
                  {sel.kind === 'zone'
                    ? t('warehouse3d.selectedZone', { name: selected.label, code: selected.code || selected.zone_id })
                    : t('warehouse3d.selectedRack', {
                      name: selected.label,
                      zone: zoneById.get(selected.zone_id)?.label || selected.zone_id || '',
                    })}
                </div>
                <div className="wh3d-ed-grid2">
                  {['x', 'y', 'w', 'h'].map((f) => (
                    <NumberField
                      key={f}
                      label={t(FIELD_LABELS[f])}
                      value={selected[f]}
                      step={step}
                      testId={`prop-${f}`}
                      onCommit={(v) => commit((d) => setField(d, sel, f, v))}
                    />
                  ))}
                </div>
                {sel.kind === 'rack' && (
                  <div className="wh3d-ed-rotate">
                    <button type="button" className="btn btn-sm" onClick={() => commit((d) => rotateItem(d, sel, -90))}>
                      {t('warehouse3d.rotateLeft')}
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => commit((d) => rotateItem(d, sel, 90))}>
                      {t('warehouse3d.rotateRight')}
                    </button>
                    <NumberField
                      label={t('warehouse3d.fieldRotation')}
                      value={selected.rotationDeg}
                      step={1}
                      testId="prop-rotation"
                      onCommit={(v) => commit((d) => setField(d, sel, 'rotationDeg', v))}
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="wh3d-ed-hint">{t('warehouse3d.editHint')}</div>
            )}
          </div>

          <div className="sim2-detail-card" data-testid="layout-issues">
            <div className="sim2-pallet-list-title">
              {live ? t('warehouse3d.liveChecks') : t('warehouse3d.serverChecks')}
              {' · '}
              {t('warehouse3d.issueCounts', { errors: errorCount, warnings: warnCount })}
            </div>
            {issues.length === 0 ? (
              <div className="wh3d-ed-hint">{t('warehouse3d.noIssues')}</div>
            ) : (
              <ul className="wh3d-list">
                {issues.slice(0, 50).map((issue, i) => (
                  <li key={`${issue.code}-${i}`}>
                    <button
                      type="button"
                      className={`wh3d-list-item wh3d-ed-issue is-${issue.severity}`}
                      onClick={() => focusIssue(issue)}
                    >
                      <strong>{issue.severity === 'error' ? t('warehouse3d.severityError') : t('warehouse3d.severityWarning')}</strong>
                      <span>{describe(issue)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
