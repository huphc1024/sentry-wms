import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '../i18n/locale.jsx';
import { buildSceneModel } from '../pages/warehouse3d/model.js';
import {
  buildDraft,
  buildPayload,
  canEditLayout,
  clamp,
  draftToMapData,
  footprint,
  historyInit,
  historyPush,
  historyRedo,
  historyUndo,
  issueTargets,
  localIssues,
  moveItem,
  normDeg,
  rectsOverlap,
  resizeRect,
  rotateItem,
  setBounds,
  setField,
  snap,
} from '../pages/warehouse3d/layoutModel.js';

// jsdom has no WebGL: stub the three.js layer as warehouse-3d.test does.
vi.mock('@react-three/fiber', () => ({
  Canvas: (props) => <div data-testid="r3f-canvas" aria-label={props['aria-label']} />,
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
const putMock = vi.fn();
vi.mock('../api.js', () => ({
  api: {
    get: (...args) => getMock(...args),
    post: (...args) => postMock(...args),
    put: (...args) => putMock(...args),
  },
}));
vi.mock('../warehouse.jsx', () => ({
  useWarehouse: () => ({ warehouseId: 1, warehouse: { warehouse_id: 1, warehouse_name: 'Kho Test' } }),
}));
let authUser = null;
vi.mock('../auth.jsx', () => ({ useAuth: () => ({ user: authUser }) }));

import Warehouse3D from '../pages/Warehouse3D.jsx';

function bin(over) {
  return {
    zone_id: 1, zone_code: 'PICK', contents: [], pallets: [], total_qty: 0, level: 1, position: 1, ...over,
  };
}

const BINS = [
  bin({ bin_id: 1, bin_code: 'A-01-01', aisle: 'A', bay: '01', rack_key: '1|A|01', rack_label: 'A-001' }),
  bin({ bin_id: 2, bin_code: 'A-02-01', aisle: 'A', bay: '02', position: 2, rack_key: '1|A|02', rack_label: 'A-002' }),
  bin({ bin_id: 3, bin_code: 'B-01-01', aisle: 'B', bay: '01', rack_key: '1|B|01', rack_label: 'B-001', rack_id: 7 }),
];

const PATH = {
  path_id: 4, path_type: 'FORKLIFT', label: 'Main', points: [{ x: 1, y: 1 }, { x: 10, y: 1 }],
  width_m: 3, one_way: false, direction: 'both', sort_order: 0,
};

/** No floor plan saved: the 3D view lays everything out automatically. */
const AUTO_MAP = {
  warehouse_id: 1,
  warehouse_code: 'WH',
  warehouse_name: 'Kho Test',
  layout: {
    config: { coordinate_unit: 'LEGACY_CANVAS', version: 1, grid_step_m: 0.25, world_width_m: 50, world_height_m: 40 },
    racks: [],
    paths: [PATH],
    has_saved_layout: false,
  },
  zones: [{ zone_id: 1, zone_code: 'PICK', zone_name: 'Pick zone', color: '#36B37E', bounds: null }],
  bins: BINS,
  racks: [],
};

/** A saved meter layout at version 3. */
const SAVED_MAP = {
  ...AUTO_MAP,
  layout: {
    config: {
      coordinate_unit: 'METER', version: 3, grid_step_m: 0.5,
      world_width_m: 40, world_height_m: 30,
      warehouse_x_m: 0, warehouse_y_m: 0, warehouse_w_m: 30, warehouse_h_m: 20,
    },
    racks: [
      { rack_id: null, rack_key: '1|A|01', label: 'A-001', x_m: 2, y_m: 2, w_m: 4, h_m: 1, rotation_deg: 0 },
      { rack_id: null, rack_key: '1|A|02', label: 'A-002', x_m: 2, y_m: 5, w_m: 4, h_m: 1, rotation_deg: 0 },
      { rack_id: 7, rack_key: '1|B|01', label: 'B-001', x_m: 10, y_m: 2, w_m: 4, h_m: 1, rotation_deg: 90 },
    ],
    paths: [PATH],
    has_saved_layout: true,
  },
  zones: [{
    zone_id: 1, zone_code: 'PICK', zone_name: 'Pick zone', color: '#36B37E',
    bounds: { x: 1, y: 1, w: 20, h: 10, stored: true, coordinate_unit: 'METER' },
  }],
};

function ok(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

// ------------------------------------------------------------------ pure

describe('layout geometry helpers', () => {
  it('snaps, clamps and folds angles', () => {
    expect(snap(1.13, 0.25)).toBe(1.25);
    expect(snap(-0.12, 0.25)).toBe(-0);
    expect(snap(2.6, 0.5)).toBe(2.5);
    expect(clamp(12, 0, 10)).toBe(10);
    expect(normDeg(-90)).toBe(270);
    expect(normDeg(450)).toBe(90);
    expect(normDeg(360)).toBe(0);
  });

  it('computes the rotated footprint about the centre', () => {
    const fp = footprint({ x: 2, y: 4, w: 6, h: 1, rotationDeg: 90 });
    expect(fp.w).toBeCloseTo(1);
    expect(fp.h).toBeCloseTo(6);
    expect(fp.x + fp.w / 2).toBeCloseTo(5);
    expect(fp.y + fp.h / 2).toBeCloseTo(4.5);
  });

  it('treats racks closer than 5 cm as overlapping', () => {
    const a = { x: 0, y: 0, w: 2, h: 1 };
    expect(rectsOverlap(a, { x: 2.02, y: 0, w: 2, h: 1 })).toBe(true);
    expect(rectsOverlap(a, { x: 2.1, y: 0, w: 2, h: 1 })).toBe(false);
  });

  it('resizes from a corner, keeping the opposite corner fixed', () => {
    const r = resizeRect({ x: 1, y: 1, w: 4, h: 2 }, 'se', 1.1, 0.9, { step: 0.5 });
    expect(r).toMatchObject({ x: 1, y: 1, w: 5, h: 3 });
    const nw = resizeRect({ x: 1, y: 1, w: 4, h: 2 }, 'nw', 1, 1, { step: 0.5 });
    expect(nw).toMatchObject({ x: 2, y: 2, w: 3, h: 1 });
    // Never below the minimum size.
    expect(resizeRect({ x: 0, y: 0, w: 1, h: 1 }, 'se', -5, -5).w).toBe(0.5);
  });

  it('resizes a rotated rack in its own frame', () => {
    const rack = { x: 0, y: 0, w: 4, h: 1, rotationDeg: 90 };
    const before = footprint(rack);
    // Rotated 90 deg the rack's long side runs down the plan: dragging the
    // 'se' handle down by 2 m lengthens it by 2 m.
    const after = resizeRect(rack, 'se', 0, 2, { step: 0.25 });
    expect(after.w).toBe(6);
    expect(after.h).toBe(1);
    const fp = footprint(after);
    // The far corner (top on the plan) stays where it was.
    expect(fp.y).toBeCloseTo(before.y);
    expect(fp.h).toBeCloseTo(6);
  });
});

describe('draft and payload', () => {
  it('starts from the automatic layout, moved to (0, 0), at version 0', () => {
    const draft = buildDraft(AUTO_MAP);
    expect(draft.source).toBe('auto');
    expect(draft.baseVersion).toBe(0);
    expect(draft.bounds.x).toBe(0);
    expect(draft.bounds.y).toBe(0);
    expect(draft.racks).toHaveLength(3);
    // Everything sits inside the materialised bounds.
    expect(localIssues(draft).filter((i) => i.code.endsWith('bounds'))).toEqual([]);
    expect(draft.zones[0]).toMatchObject({ zone_id: 1, persist: true });
  });

  it('starts from the saved meter layout and its version', () => {
    const draft = buildDraft(SAVED_MAP);
    expect(draft.source).toBe('layout');
    expect(draft.baseVersion).toBe(3);
    expect(draft.grid).toBe(0.5);
    expect(draft.bounds).toEqual({ x: 0, y: 0, w: 30, h: 20 });
    const b = draft.racks.find((r) => r.rack_key === '1|B|01');
    expect(b).toMatchObject({ rack_id: 7, x: 10, y: 2, w: 4, h: 1, rotationDeg: 90 });
    expect(draft.zones[0]).toMatchObject({ x: 1, y: 1, w: 20, h: 10 });
  });

  it('builds the PUT payload the schema expects', () => {
    const draft = rotateItem(buildDraft(SAVED_MAP), { kind: 'rack', id: 'id:7' }, 300);
    const body = buildPayload(draft);
    expect(body.base_version).toBe(3);
    expect(body.layout).toEqual({
      coordinate_unit: 'METER',
      world_width_m: 40,
      world_height_m: 30,
      warehouse_x_m: 0,
      warehouse_y_m: 0,
      warehouse_w_m: 30,
      warehouse_h_m: 20,
      grid_step_m: 0.5,
    });
    expect(body.zones).toEqual([{ zone_id: 1, map_x: 1, map_y: 1, map_w: 20, map_h: 10 }]);
    const b = body.racks.find((r) => r.rack_key === '1|B|01');
    expect(b).toEqual({
      rack_id: 7, rack_key: '1|B|01', zone_id: 1, label: 'B-001',
      x_m: 10, y_m: 2, w_m: 4, h_m: 1, rotation_deg: 30,
    });
    // Racks without a database row are sent by key only.
    expect(body.racks.find((r) => r.rack_key === '1|A|01')).not.toHaveProperty('rack_id');
    // Saved lanes go back unchanged (saving replaces the warehouse's lanes).
    expect(body.paths).toEqual([PATH]);
  });

  it('moves a zone with its racks, snapped to the grid', () => {
    const draft = buildDraft(SAVED_MAP);
    const next = moveItem(draft, { kind: 'zone', id: 1 }, 2.2, 0.9, { withRacks: true });
    expect(next.zones[0]).toMatchObject({ x: 3, y: 2 });
    expect(next.racks.find((r) => r.rack_key === '1|A|01')).toMatchObject({ x: 4, y: 3 });
    const alone = moveItem(draft, { kind: 'zone', id: 1 }, 2, 0, { withRacks: false });
    expect(alone.racks.find((r) => r.rack_key === '1|A|01').x).toBe(2);
  });

  it('edits fields and bounds, ignoring bad input', () => {
    const draft = buildDraft(SAVED_MAP);
    const sel = { kind: 'rack', id: 'key:1|A|01' };
    expect(setField(draft, sel, 'x', 'abc')).toBe(draft);
    expect(setField(draft, sel, 'w', 0.1).racks[0].w).toBe(0.5);
    expect(setField(draft, sel, 'rotationDeg', -90).racks[0].rotationDeg).toBe(270);
    expect(setBounds(draft, 'w', 9999).bounds.w).toBe(500);
  });

  it('flags overlaps and items outside the warehouse locally', () => {
    let draft = buildDraft(SAVED_MAP);
    draft = setField(draft, { kind: 'rack', id: 'key:1|A|02' }, 'y', 2.5);
    draft = setBounds(draft, 'w', 12);
    const issues = localIssues(draft);
    expect(issues).toContainEqual({ severity: 'error', code: 'racks_overlap', rack_keys: ['1|A|01', '1|A|02'] });
    expect(issues).toContainEqual({ severity: 'error', code: 'zone_beyond_bounds', zone_ids: [1] });
    const targets = issueTargets(issues);
    expect(targets.errorRacks.has('1|A|02')).toBe(true);
    expect(targets.errorZones.has(1)).toBe(true);
  });

  it('feeds the 3D model from the draft', () => {
    const draft = setField(buildDraft(AUTO_MAP), { kind: 'rack', id: 'id:7' }, 'x', 9);
    const model = buildSceneModel(draftToMapData(AUTO_MAP, draft));
    expect(model.source).toBe('layout');
    expect(model.racks.find((r) => r.rack_id === 7).x).toBe(9);
  });

  it('keeps an undo / redo history', () => {
    const d0 = buildDraft(SAVED_MAP);
    const d1 = setField(d0, { kind: 'zone', id: 1 }, 'x', 4);
    let h = historyPush(historyInit(d0), d1);
    expect(h.past).toHaveLength(1);
    // An unchanged draft is not a step.
    expect(historyPush(h, { ...d1 }).past).toHaveLength(1);
    h = historyUndo(h);
    expect(h.present).toBe(d0);
    h = historyRedo(h);
    expect(h.present).toBe(d1);
  });

  it('lets ADMIN or the warehouse-map-edit override edit', () => {
    expect(canEditLayout(null)).toBe(false);
    expect(canEditLayout({ role: 'ADMIN' })).toBe(true);
    expect(canEditLayout({ role: 'USER', allowed_overrides: [] })).toBe(false);
    expect(canEditLayout({ role: 'USER', allowed_overrides: ['warehouse-map-edit'] })).toBe(true);
  });
});

// ------------------------------------------------------------------ editor

function mockMap(map) {
  getMock.mockImplementation(async (path) => {
    if (path.startsWith('/admin/warehouse-map/pick-paths')) return ok({ batches: [] });
    return ok(map);
  });
}

async function renderPage() {
  const view = render(
    <MemoryRouter>
      <LocaleProvider>
        <Warehouse3D />
      </LocaleProvider>
    </MemoryRouter>,
  );
  await view.findByText('3D warehouse — Kho Test');
  await waitFor(() => expect(view.getByTestId('r3f-canvas')).toBeInTheDocument());
  return view;
}

async function openEditor(map = SAVED_MAP) {
  mockMap(map);
  const view = await renderPage();
  fireEvent.click(await view.findByRole('button', { name: 'Edit layout' }));
  const editor = view.getByTestId('layout-editor');
  return { view, editor: within(editor) };
}

function drag(target, plan, dx, dy) {
  fireEvent.pointerDown(target, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
  fireEvent.pointerMove(plan, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
  fireEvent.pointerUp(plan, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
}

describe('layout editor on the 3D page', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    putMock.mockReset();
    authUser = { role: 'ADMIN', allowed_overrides: [] };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    window.confirm.mockClear();
  });

  it('hides Edit layout from users without ADMIN or the override', async () => {
    authUser = { role: 'USER', allowed_overrides: ['so-full-edit'] };
    mockMap(SAVED_MAP);
    const view = await renderPage();
    expect(view.queryByRole('button', { name: 'Edit layout' })).toBeNull();
  });

  it('shows Edit layout to a user holding the override', async () => {
    authUser = { role: 'USER', allowed_overrides: ['warehouse-map-edit'] };
    mockMap(SAVED_MAP);
    const view = await renderPage();
    expect(await view.findByRole('button', { name: 'Edit layout' })).toBeInTheDocument();
  });

  it('drags a rack and saves the moved position with the loaded version', async () => {
    const { view, editor } = await openEditor();
    // The 3D preview stays beside the editor.
    expect(view.getByTestId('r3f-canvas')).toBeInTheDocument();
    const plan = editor.getByTestId('layout-plan');
    // jsdom has no layout, so one pixel is one metre.
    drag(editor.getByTestId('rack-key:1|A|01'), plan, 3.2, 0);
    expect(editor.getByTestId('prop-x')).toHaveValue(5);
    expect(editor.getByTestId('layout-dirty')).toHaveTextContent('Unsaved changes');

    putMock.mockResolvedValue(ok({ version: 4, warnings: [], layout: {} }));
    fireEvent.click(editor.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    const [url, body] = putMock.mock.calls[0];
    expect(url).toBe('/admin/warehouse-map/layout?warehouse_id=1');
    expect(body.base_version).toBe(3);
    expect(body.racks.find((r) => r.rack_key === '1|A|01')).toMatchObject({ x_m: 5, y_m: 2 });
    expect(body.paths).toEqual([PATH]);
    // Saved: the editor closes, the map is reloaded and a notice shown.
    expect(await view.findByText('Floor plan saved (version 4).')).toBeInTheDocument();
    expect(view.queryByTestId('layout-editor')).toBeNull();
  });

  it('resizes a zone from its corner handle', async () => {
    const { editor } = await openEditor();
    const plan = editor.getByTestId('layout-plan');
    fireEvent.pointerDown(editor.getByTestId('zone-1'), { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerUp(plan, { pointerId: 1 });
    drag(editor.getByTestId('handle-se'), plan, 2, 1);
    expect(editor.getByTestId('prop-w')).toHaveValue(22);
    expect(editor.getByTestId('prop-h')).toHaveValue(11);
  });

  it('edits numbers in the properties panel and rotates racks', async () => {
    const { editor } = await openEditor();
    drag(editor.getByTestId('rack-id:7'), editor.getByTestId('layout-plan'), 0, 0);
    const y = editor.getByTestId('prop-y');
    fireEvent.change(y, { target: { value: '6' } });
    fireEvent.blur(y);
    fireEvent.click(editor.getByRole('button', { name: 'Rotate +90°' }));
    expect(editor.getByTestId('prop-rotation')).toHaveValue(180);
    const rot = editor.getByTestId('prop-rotation');
    fireEvent.change(rot, { target: { value: '45' } });
    fireEvent.keyDown(rot, { key: 'Enter' });

    putMock.mockResolvedValue(ok({ version: 4 }));
    fireEvent.click(editor.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(putMock.mock.calls[0][1].racks.find((r) => r.rack_id === 7))
      .toMatchObject({ y_m: 6, rotation_deg: 45 });
  });

  it('nudges with arrow keys, ignores Delete, and undoes', async () => {
    const { editor } = await openEditor();
    const plan = editor.getByTestId('layout-plan');
    drag(editor.getByTestId('rack-key:1|A|02'), plan, 0, 0);
    fireEvent.keyDown(plan, { key: 'ArrowRight' });
    fireEvent.keyDown(plan, { key: 'ArrowDown' });
    expect(editor.getByTestId('prop-x')).toHaveValue(2.5);
    expect(editor.getByTestId('prop-y')).toHaveValue(5.5);
    fireEvent.keyDown(plan, { key: 'Delete' });
    expect(editor.getByTestId('rack-key:1|A|02')).toBeInTheDocument();
    fireEvent.click(editor.getByRole('button', { name: 'Undo' }));
    expect(editor.getByTestId('prop-y')).toHaveValue(5);
    fireEvent.click(editor.getByRole('button', { name: 'Redo' }));
    expect(editor.getByTestId('prop-y')).toHaveValue(5.5);
  });

  it('edits the warehouse size and highlights what falls outside', async () => {
    const { editor } = await openEditor();
    const w = editor.getByTestId('bounds-w');
    fireEvent.change(w, { target: { value: '12' } });
    fireEvent.blur(w);
    expect(editor.getByTestId('zone-1')).toHaveClass('has-error');
    expect(editor.getByText('Zone Pick zone is outside the warehouse.')).toBeInTheDocument();
  });

  it('validates on the server and highlights the racks it names', async () => {
    const { editor } = await openEditor();
    postMock.mockResolvedValue(ok({
      valid: false,
      errors: ['Racks 1|A|01 and 1|A|02 overlap'],
      warnings: [],
      issues: [{ severity: 'error', code: 'racks_overlap', message: 'x', rack_keys: ['1|A|01', '1|A|02'] }],
    }));
    fireEvent.click(editor.getByRole('button', { name: 'Validate' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0][0]).toBe('/admin/warehouse-map/layout/validate?warehouse_id=1');
    expect(postMock.mock.calls[0][1].base_version).toBe(3);
    expect(await editor.findByText('The layout has 1 errors and 0 warnings.')).toBeInTheDocument();
    expect(editor.getByText('Racks A-001 and A-002 overlap.')).toBeInTheDocument();
    expect(editor.getByTestId('rack-key:1|A|01')).toHaveClass('has-error');
    expect(editor.getByTestId('rack-key:1|A|02')).toHaveClass('has-error');
  });

  it('explains a version conflict and reloads on request', async () => {
    const { editor } = await openEditor();
    drag(editor.getByTestId('rack-key:1|A|01'), editor.getByTestId('layout-plan'), 1, 0);
    putMock.mockResolvedValue(ok({ error: 'Layout was updated by another user.', current_version: 5 }, 409));
    fireEvent.click(editor.getByRole('button', { name: 'Save layout' }));
    expect(await editor.findByText(/Someone else saved this floor plan/)).toBeInTheDocument();
    const calls = getMock.mock.calls.length;
    fireEvent.click(editor.getByRole('button', { name: 'Reload latest layout' }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(getMock.mock.calls.length).toBeGreaterThan(calls));
  });

  it('starts from the automatic layout and allows the first save', async () => {
    const { editor } = await openEditor(AUTO_MAP);
    expect(editor.getByText(/starts from the automatic layout/)).toBeInTheDocument();
    putMock.mockResolvedValue(ok({ version: 1 }));
    fireEvent.click(editor.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(putMock).toHaveBeenCalled());
    const body = putMock.mock.calls[0][1];
    expect(body.base_version).toBe(0);
    expect(body.racks).toHaveLength(3);
    expect(body.layout.warehouse_x_m).toBe(0);
  });

  it('asks before discarding changes on Cancel', async () => {
    const { view, editor } = await openEditor();
    drag(editor.getByTestId('rack-key:1|A|01'), editor.getByTestId('layout-plan'), 1, 0);
    window.confirm.mockReturnValueOnce(false);
    fireEvent.click(editor.getByRole('button', { name: 'Cancel' }));
    expect(view.getByTestId('layout-editor')).toBeInTheDocument();
    fireEvent.click(editor.getByRole('button', { name: 'Cancel' }));
    expect(view.queryByTestId('layout-editor')).toBeNull();
    expect(window.confirm).toHaveBeenCalledTimes(2);
  });

  it('asks before an in-app link leaves unsaved changes', async () => {
    const { view, editor } = await openEditor();
    fireEvent.click(view.getByRole('link', { name: 'Open 2D simulation' }));
    expect(window.confirm).not.toHaveBeenCalled();
    drag(editor.getByTestId('rack-key:1|A|01'), editor.getByTestId('layout-plan'), 1, 0);
    window.confirm.mockReturnValueOnce(false);
    fireEvent.click(view.getByRole('link', { name: 'Open 2D simulation' }));
    expect(window.confirm).toHaveBeenCalledWith('Discard the unsaved layout changes?');
  });
});
