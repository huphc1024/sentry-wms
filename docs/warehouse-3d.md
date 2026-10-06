# 3D Warehouse View

Admin page `/warehouse-3d` ("3D warehouse" / "Kho 3D" in the sidebar, next to
Simulation) draws the selected warehouse in 3D with three.js
(`@react-three/fiber` + `@react-three/drei`). It sits beside the 2D simulation
(`/warehouse-simulation`) so the two can be compared; each page links to the
other.

## Access

Same gate as the 2D simulation: page key `warehouse-simulation` (ADMIN sees it
always). No new page key. Data comes from:

| Endpoint | Use |
|---|---|
| `GET /api/admin/warehouse-map?warehouse_id=` | zones, bins (stock, pallets, lots), racks and the saved floor plan (`layout`) — the same payload the 2D page reads |
| `GET /api/admin/warehouse-map/pick-paths?warehouse_id=` | new, read-only: OPEN / IN_PROGRESS pick batches plus the 10 most recent COMPLETED ones, each with its tasks (`bin_id`, `bin_code`, `sku`, `quantity_to_pick`, `status`, `pick_sequence`) in walk order. RELEASED tasks are left out. Gated by `warehouse-simulation` and `check_warehouse_access`. |

The admin Picking Batches list (`/api/admin/pick-batches`) was not reused: it is
gated by the `picking-batches` key and returns no task rows.

## What it shows

- **Floor and zones** — when the warehouse has a saved meter layout
  (`warehouse_layouts.coordinate_unit = 'METER'`), the floor, zone rectangles
  and rack positions / `rotation_deg` come from it. Anything without a saved
  position is laid out automatically: one row per aisle with bays in order,
  bins without an aisle as a grid of floor slots, zones shelf-packed. A note in
  the legend says when the layout is automatic.
- **Racks and bins** — each rack gets uprights and one shelf per level; each
  bin is a box on its `level` at its `position` along the rack's long side.
  Stocked bins are tall boxes, empty ones thin slabs. Bins are drawn with one
  instanced mesh, so thousands of bins stay one draw call.
- **Colour by** — *Status* (the 2D rule: empty / occupied / expiring, the last
  meaning a pallet expires within 30 days), *Fill level* (quantity against the
  95th percentile of stocked bins, in quarters — bins carry no unit capacity),
  *Expiry* (soonest dated stock on hand: expired / within 30 days / later /
  none). Colours are read from the theme's `--map-*` CSS variables and follow
  light / dark mode.
- **Camera** — drag to rotate, scroll to zoom, right-drag to pan; *Reset view*
  and *Top-down view* buttons.
- **Hover / click** — hover shows bin code and quantity; click opens the bin
  detail panel (same component as the 2D page: pallets with stock, unpalletized
  stock, empty pallets) with the shared *Attach pallet* action.
- **Search** — SKU, item name, lot, pallet code / id or bin code, matched with
  the 2D page's rules. Matches glow, everything else is dimmed; the count and a
  clickable list of matching bins appear beside the scene.
- **Pick route** — choose a batch; its stops are drawn above the floor in
  `pick_sequence` order with direction arrows and numbered markers.
  Consecutive tasks in the same bin are one stop. The panel lists the stops
  (picked ones faded); tasks in bins not on the map are counted, not drawn.

## Editing the floor plan

*Edit layout* ("Chỉnh bố trí") opens a top-down 2D editor (SVG) beside the 3D
view; the 3D view draws the draft and follows every change.

- **Who** — the button shows only for ADMIN or a user holding the
  `warehouse-map-edit` override (`user.allowed_overrides` from `/auth/me`),
  the same rule the API enforces on the layout endpoints (403 otherwise).
  Viewing stays on the `warehouse-simulation` page key.
- **Starting point** — the saved meter layout and its `version`. Without one
  (`source: auto`) the draft is the automatic layout, moved so the floor starts
  at (0, 0), with `base_version` 0: the first save stores it in metres.
- **Editing** — drag a zone or rack to move it (moving a zone carries its racks
  unless *Move racks with their zone* is off); drag a corner handle to resize
  (the opposite corner stays put, also on a rotated rack); rotate racks with
  ±90° or a degree value. Positions and sizes snap to `grid_step_m`. Arrow keys
  nudge the selection one grid step (Shift: four). Delete does nothing — zones
  and racks are not removed here. The panel edits X, Y, width, depth (and
  rotation) in metres, and the warehouse width / depth.
- **Checks** — overlaps and items outside the warehouse are flagged live and
  outlined on the plan; *Validate* runs `POST .../layout/validate` and lists
  its errors and warnings (click one to select the item).
- **Save** — `PUT /api/admin/warehouse-map/layout` with every zone and rack and
  the saved lanes unchanged (saving replaces the warehouse's lanes with the
  list sent). A 409 (someone saved first) offers *Reload latest layout*; a 400
  lists the errors. *Undo* / *Redo* (also Ctrl+Z / Ctrl+Y) keep a 100-step
  history; *Cancel*, in-app links and closing the tab ask before discarding
  unsaved changes.

Payload (`SaveWarehouseLayoutRequest`):

```json
{
  "base_version": 3,
  "layout": {"coordinate_unit": "METER", "world_width_m": 40, "world_height_m": 30,
             "warehouse_x_m": 0, "warehouse_y_m": 0, "warehouse_w_m": 30,
             "warehouse_h_m": 20, "grid_step_m": 0.5},
  "zones": [{"zone_id": 1, "map_x": 1, "map_y": 1, "map_w": 20, "map_h": 10}],
  "racks": [{"rack_id": 7, "rack_key": "1|B|01", "zone_id": 1, "label": "B-001",
             "x_m": 10, "y_m": 2, "w_m": 4, "h_m": 1, "rotation_deg": 90}],
  "paths": ["…saved lanes, unchanged…"]
}
```

A rack is its unrotated rectangle plus `rotation_deg`, turned clockwise about
its centre. Validation checks bounds, zone containment, overlaps and lane
crossings against the rotated footprint, and besides the `errors` /
`warnings` strings returns `issues`: `{severity, code, message, rack_keys?,
zone_ids?, path?}`, which the editor uses to highlight and translate.

## Code

| File | Role |
|---|---|
| `admin/src/pages/Warehouse3D.jsx` | page: data loading, controls, side panel (lazy-loaded route) |
| `admin/src/pages/warehouse3d/model.js` | pure layout / placement / colour / search / route helpers (unit-tested) |
| `admin/src/pages/warehouse3d/LayoutEditor.jsx` | 2D floor-plan editor (SVG + pointer events) |
| `admin/src/pages/warehouse3d/layoutModel.js` | pure draft / snap / resize / overlap / payload / history helpers (unit-tested) |
| `api/services/warehouse_layout_service.py` | `validate_layout_issues`, `save_warehouse_layout` |
| `admin/src/pages/warehouse3d/WarehouseScene.jsx` | three.js scene (instanced bins and rack frames, zone labels, route) |
| `admin/src/pages/warehouse3d/palette.js` | theme colours from CSS variables |
| `admin/src/components/simulation/BinDetailCard.jsx`, `AttachPalletModal.jsx` | bin detail and attach-pallet flow shared with the 2D page |
| `admin/src/pages/simulation/binModel.js` | bin status / stock split / search matching shared with the 2D page |

three.js, fiber and drei are bundled into their own `three` chunk
(`admin/vite.config.js`), fetched only when `/warehouse-3d` is opened.

## Demo data

`scripts/seed_prodlike.py` creates pick batches for the 3D route (see
[Production-like Demo Data](prodlike-data.md)): in `SL-HCM` one IN_PROGRESS
batch (first half of the stops picked), two OPEN and two COMPLETED; in `SL-HN`
one OPEN and one COMPLETED.

## Known limits

- The route joins stops in a straight line; it does not follow aisles or the
  `warehouse_map_paths` lanes.
- The automatic layout is a stand-in for a drawn floor plan: positions are
  plausible, not real.
- The layout editor moves, resizes and rotates existing zones and racks; it
  does not add or delete them, and does not edit lanes (`warehouse_map_paths`).
- Leaving with unsaved edits is guarded for in-app links and closing the tab;
  browser Back is not intercepted (the admin uses the declarative router).
- Rotation is free (any degree), but rotated racks are checked by their
  axis-aligned footprint, so a rack at 45° reserves more floor than it covers.

## Mobile app (handheld, read-only)

The scanner app has its own 3D view ("KHO 3D" on the home screen, and
"XEM KHO 3D" on the pick-walk screen). It is **view only**: no layout
editing, no pallet attach, no stock changes.

**Requires a new APK build.** It adds native modules (`expo-gl`,
`expo-file-system`), so an over-the-air JS update is not enough: rebuild
the APK (`npm run build:apk`, or `cd mobile/android && ./gradlew
assembleRelease`) and reinstall. Do not run `expo prebuild --clean`; the
`android/` folder carries the Chainway scanner customisations.

- **Data**: `GET /api/warehouse-map?warehouse_id=` -- the existing mobile
  map endpoint (any signed-in floor user with access to the warehouse; same
  `build_warehouse_map` payload as the admin endpoint). No new endpoint.
  In route mode it also reads the picker's own batch with
  `GET /api/picking/batch/<id>`; tasks are matched to map bins by
  `bin_code`.
- **Screen**: zones tinted with code labels, multi-level racks, bins coloured
  by status / fill / expiry (same buckets and legend as the web page).
  One finger rotates, pinch zooms, two fingers pan; Reset and Top buttons.
- **Search / scan**: the scan box takes the hardware scanner (keyboard or
  intent mode), the camera, or typed text. SKU / item / lot / pallet / bin
  code match like the web search; a scanned bin or pallet barcode also
  matches exactly. Other bins dim; the match count is shown; a single match
  opens its bin.
- **Bin panel**: tap a bin (or a numbered stop) for its code, zone / slot,
  pallets and loose stock (SKU, name, qty, lot, expiry).
- **Pick route** (opened from pick walk): numbered stops in walk order, the
  walked part faded, the next stop highlighted with a beacon; the camera
  starts on the next stop and "Next stop" re-frames it.

Performance measures for low-power handhelds: the screen and three.js are
loaded lazily on first open; bins, shelves, posts and route pieces are
instanced (a handful of draw calls); Lambert / basic materials, one
directional light, no shadows, no antialiasing; `frameloop="demand"` (a
frame is drawn only when the camera moves or data changes); the GL view is
rendered at most at 1.5x pixel ratio and scaled up (expo-gl itself always
renders at the native ratio); at most 30 text labels, drawn as React Native
views over the canvas.

| File | Role |
|---|---|
| `mobile/src/screens/Warehouse3DScreen.js` | screen: data, gestures, labels, legend, bin panel |
| `mobile/src/warehouse3d/WarehouseCanvas.js` | `@react-three/fiber/native` scene |
| `mobile/src/warehouse3d/model.js`, `binModel.js`, `palette.js` | copies of the admin pure modules (a test fails if `model.js` drifts) |
| `mobile/src/warehouse3d/sceneUtils.js` | orbit camera, projection, tap picking, scan matching, route glue |
