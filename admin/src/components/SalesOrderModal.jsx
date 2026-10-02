import { Fragment, useState, useEffect } from 'react';
import { api } from '../api.js';
import { formatDateOnly } from '../utils/date.js';
import { shipMethodDisplay } from '../utils/shipMethod.js';
import { useAuth } from '../auth.jsx';
import { useLocale } from '../i18n/locale.jsx';
import RichText from '../i18n/RichText.jsx';
import Modal from './Modal.jsx';
import StatusTag from './StatusTag.jsx';
import CreateRmaModal from './CreateRmaModal.jsx';
import SkuBarcodeAutocomplete from './SkuBarcodeAutocomplete.jsx';
import { resolveItemFromScan } from '../utils/itemScanOptions.js';

const EDITABLE_STATUS_OPTIONS = ['OPEN', 'PICKED', 'PACKED', 'SHIPPED', 'CANCELLED', 'REFUNDED'];
// Lines are terminal once the SO has shipped, cancelled, or been refunded.
// Header edits remain ADMIN-only for SHIPPED (external-system backfill); for
// CANCELLED / REFUNDED the operator should reopen via the cancel-undo
// workflow, not edit. REFUNDED is a terminal label (mig 074) -- it is not in
// STATUS_ORDER, so setting it routes through the normal PUT, never the
// backward revert-status flow.
const LINE_TERMINAL_STATUSES = new Set(['SHIPPED', 'CANCELLED', 'REFUNDED']);
// so-refinement: forward-flow ordering. Mirrors _STATUS_ORDER in
// api/services/sales_order_service.py. PICKING / PACKING / ALLOCATED
// were retired in mig 060; the live flow is
// OPEN -> PICKED -> PACKED -> SHIPPED. Backward transitions from
// PICKED/PACKED/SHIPPED require the revert-status flow so pick / pack /
// ship side effects are unwound.
const STATUS_ORDER = {
  OPEN: 0, PICKED: 1, PACKED: 2, SHIPPED: 3,
};
const REVERTABLE_STATUSES = new Set(['PICKED', 'PACKED', 'SHIPPED']);

// Matches PurchaseOrders.formatApiError: surfaces field-level details
// from the @validate_body decorator instead of the bare "validation_error".
function formatApiError(data, fallback) {
  if (!data) return fallback;
  if (Array.isArray(data.details) && data.details.length > 0) {
    return data.details
      .map((d) => {
        const field = Array.isArray(d.loc) && d.loc.length ? d.loc.join('.') : 'request';
        return `${field}: ${d.msg}`;
      })
      .join('; ');
  }
  return data.error || fallback;
}

// v1.8.0 (#268) per-component billing/shipping address fields. Order
// must match the canonical column ordering for round-trip consistency.
const ADDRESS_FIELD_KEYS = [
  'billing_address_name', 'billing_address_line1', 'billing_address_line2',
  'billing_address_city', 'billing_address_state',
  'billing_address_postal_code', 'billing_address_country',
  'billing_address_phone',
  'shipping_address_name', 'shipping_address_line1', 'shipping_address_line2',
  'shipping_address_city', 'shipping_address_state',
  'shipping_address_postal_code', 'shipping_address_country',
  'shipping_address_phone',
];

const ADDRESS_FIELD_LABELS = {
  billing_address_name: 'common.name',
  billing_address_line1: 'salesOrders.addr.line1',
  billing_address_line2: 'salesOrders.addr.line2',
  billing_address_city: 'salesOrders.addr.city',
  billing_address_state: 'salesOrders.addr.state',
  billing_address_postal_code: 'salesOrders.addr.postalCode',
  billing_address_country: 'salesOrders.addr.country',
  billing_address_phone: 'common.phone',
  shipping_address_name: 'common.name',
  shipping_address_line1: 'salesOrders.addr.line1',
  shipping_address_line2: 'salesOrders.addr.line2',
  shipping_address_city: 'salesOrders.addr.city',
  shipping_address_state: 'salesOrders.addr.state',
  shipping_address_postal_code: 'salesOrders.addr.postalCode',
  shipping_address_country: 'salesOrders.addr.country',
  shipping_address_phone: 'common.phone',
};

function NullableValue({ value }) {
  const { t } = useLocale();
  if (value === null || value === undefined || value === '') {
    return <span style={{ color: 'var(--text-secondary)' }}>-</span>;
  }
  return <span>{value}</span>;
}

// Operator-facing names for the post-fulfillment order types. The raw
// column values are lowercase enum strings; nobody on the floor calls a
// return SO a "return", they call it an RMA.
const RELATED_TYPE_LABELS = {
  sale: 'salesOrders.relType.sale',
  backorder: 'salesOrders.relType.backorder',
  return: 'salesOrders.relType.return',
  refund: 'salesOrders.relType.refund',
  replacement: 'salesOrders.relType.replacement',
  exchange: 'salesOrders.relType.exchange',
};

// The SO's whole parent/child family: the original order, everything
// hanging off it, and everything hanging off those in turn. Rendered as a
// tree because depth carries meaning -- an RMA against a backorder is a
// different thing from an RMA against the original order, and production
// has both shapes.
//
// Each row does exactly one thing per control: the caret expands that
// record's line items in place, the record number opens it. Read-only;
// no action here mutates anything.
function RelatedRecordsTab({ related, expanded, onToggleLines, onOpen }) {
  const { t } = useLocale();
  if (!related) {
    return (
      <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        {t('salesOrders.relatedLoadFailed')}
      </p>
    );
  }
  if (related.related_count === 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--text-secondary)' }} data-testid="related-empty">
        {t('salesOrders.relatedEmpty')}
      </p>
    );
  }

  return (
    <table className="lines-table" data-testid="related-table">
      <thead>
        <tr>
          <th>{t('salesOrders.record')}</th>
          <th>{t('common.type')}</th>
          <th>{t('common.status')}</th>
          <th>{t('salesOrders.created')}</th>
        </tr>
      </thead>
      <tbody>
        {related.records.map((r) => {
          const isOpen = expanded.includes(r.so_id);
          const lines = r.lines || [];
          return (
            <Fragment key={r.so_id}>
              <tr
                className={[
                  'related-row',
                  r.is_current ? 'current' : '',
                  r.is_voided ? 'voided' : '',
                ].filter(Boolean).join(' ')}
                data-testid={`related-row-${r.so_id}`}
              >
                {/* Depth as indentation. A grandchild sits under the child
                    it belongs to, not under the root. */}
                <td style={{ paddingLeft: 8 + r.depth * 22 }}>
                  <button
                    type="button"
                    className="related-caret"
                    onClick={() => onToggleLines(r.so_id)}
                    aria-label={isOpen ? t('salesOrders.hideLineItems') : t('salesOrders.showLineItems')}
                    aria-expanded={isOpen}
                    data-testid={`related-caret-${r.so_id}`}
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                  <button
                    type="button"
                    className="related-number"
                    onClick={() => onOpen(r)}
                    disabled={r.is_current}
                    data-testid={`related-open-${r.so_id}`}
                  >
                    {r.so_number}
                  </button>
                  {r.is_current && <span className="related-here">{t('salesOrders.youAreHere')}</span>}
                  {r.is_voided && <span className="related-voided-tag">{t('salesOrders.voided')}</span>}
                </td>
                <td>{RELATED_TYPE_LABELS[r.order_type] ? t(RELATED_TYPE_LABELS[r.order_type]) : r.order_type}</td>
                <td><StatusTag status={r.status} /></td>
                <td className="mono">
                  {r.created_at ? formatDateOnly(r.created_at) : '-'}
                </td>
              </tr>
              {isOpen && (
                <tr data-testid={`related-lines-${r.so_id}`}>
                  <td colSpan={4} className="related-lines">
                    {lines.length > 0 ? (
                      <table className="lines-table" style={{ marginLeft: 8 + r.depth * 22 }}>
                        <thead>
                          <tr>
                            <th>{t('common.sku')}</th>
                            <th>{t('common.itemName')}</th>
                            <th style={{ textAlign: 'right' }}>{t('salesOrders.ordered')}</th>
                            {/* A return's meaningful quantity is what came
                                back, not what shipped, so the column swaps
                                with the record type. */}
                            <th style={{ textAlign: 'right' }}>
                              {r.order_type === 'return' ? t('salesOrders.received') : t('salesOrders.shipped')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((l) => (
                            <tr key={l.so_line_id}>
                              <td className="mono">{l.sku}</td>
                              <td>{l.item_name}</td>
                              <td className="mono" style={{ textAlign: 'right' }}>
                                {l.quantity_ordered}
                              </td>
                              <td className="mono" style={{ textAlign: 'right' }}>
                                {r.order_type === 'return'
                                  ? l.quantity_received
                                  : l.quantity_shipped}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                        {t('salesOrders.noLineItems')}
                      </p>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
// Extracted from pages/SalesOrders.jsx so any page can open a sales order
// in place instead of navigating to the Sales Orders list first (issue
// : working the backorder queue meant one navigation away and one
// navigation back per order).
//
// Contract:
//   soId       which order to show; falsy renders nothing
//   mode       'view' (read-only detail) or 'edit' (the form)
//   onClose    operator dismissed the modal; the parent clears soId
//   onChanged  something was written. Called bare to refresh a list, or
//              with { message } when the parent should also show a banner.
//   onNavigate operator moved to a related record inside the modal.
//              Receives that record's so_id so a page can sync its URL or
//              highlight a row. Informational only: the modal owns the
//              navigation and its own back trail regardless.
export default function SalesOrderModal({ soId, mode = 'view', onClose, onChanged, onNavigate }) {
  const { t } = useLocale();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const hasSOFullEdit = isAdmin || (user?.allowed_overrides || []).includes('so-full-edit');

  const [selectedSO, setSelectedSO] = useState(null);
  const [soLines, setSOLines] = useState([]);
  const [creatingRma, setCreatingRma] = useState(false);
  // Related Records tab. `related` is the SO's whole parent/child family
  // (root plus every descendant) as returned by GET .../related, already
  // ordered and carrying a depth per row. `relatedNav` is the trail of
  // records the operator walked through to get here: clicking a related
  // record swaps this modal's contents in place and pushes the record
  // being left onto the trail, so the back arrow in the modal header can
  // return them. Cleared whenever the modal closes.
  const [soTab, setSOTab] = useState('details');
  const [related, setRelated] = useState(null);
  const [relatedNav, setRelatedNav] = useState([]);
  const [expandedRelated, setExpandedRelated] = useState([]);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editError, setEditError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Partial-fulfill sub-modal. partialFulfilling holds the SO
  // being shorted; partialForm carries the per-line short_qty inputs
  // (keyed by so_line_id) plus a free-text reason. Banner message
  // appears on the SO list after a successful partial-fulfill so the
  // operator sees "Backorder SO-12345-BO created" without a toast lib.
  const [partialFulfilling, setPartialFulfilling] = useState(null);
  const [partialForm, setPartialForm] = useState({ shorts: {}, reason: '' });
  const [partialError, setPartialError] = useState('');
  const [partialSubmitting, setPartialSubmitting] = useState(false);
  // Admin virtual-pick sub-modal: per-line list of {bin_id, quantity}
  // entries. Two entries on the same line model a split-bin pick.
  // adminPickBinsByLine caches the GET /available-bins response per
  // so_line_id so the dropdowns render without a fetch on every keystroke.
  const [adminPicking, setAdminPicking] = useState(null);
  const [adminPickForm, setAdminPickForm] = useState({});
  const [adminPickBinsByLine, setAdminPickBinsByLine] = useState({});
  const [adminPickError, setAdminPickError] = useState('');
  const [adminPickSubmitting, setAdminPickSubmitting] = useState(false);
  const [adminShipping, setAdminShipping] = useState(null);
  const [adminShipError, setAdminShipError] = useState('');
  const [adminShipSubmitting, setAdminShipSubmitting] = useState(false);
  // Blocking under-picked lines the backend refused (kind=silent_shortfall).
  // Non-null while the "ship anyway" acknowledgement is being offered.
  const [adminShipShortfall, setAdminShipShortfall] = useState(null);
  // so-refinement: backward status transition confirmation modal.
  // Carries { newStatus, pickTasks, keepIds, error, busy, mode }.
  // Checked rows (in keepIds) stay PICKED; unchecked rows release.
  // Address fields moved inline into editForm; the separate
  // address modal is retired.
  const [revertConfirm, setRevertConfirm] = useState(null);
  // SO line CRUD inside the edit modal (mig 062). State
  // mirrors PurchaseOrders.jsx: editLines is the working copy, optimistic
  // PATCH/POST/DELETE update it without refetching; lineErrors keep
  // the inline rejection visible per row.
  const [editLines, setEditLines] = useState([]);
  const [lineErrors, setLineErrors] = useState({});
  const [newLineSku, setNewLineSku] = useState('');
  const [newLineQty, setNewLineQty] = useState('');
  const [newLineError, setNewLineError] = useState('');
  const [addingLine, setAddingLine] = useState(false);
  const [resolvedItem, setResolvedItem] = useState(null);
  // Allocation-release confirm: shows what will happen before the
  // PATCH/DELETE leaves the browser so the operator can back out.
  // intent === 'shrink' carries a target qty; 'delete' just removes.
  const [releaseConfirm, setReleaseConfirm] = useState(null);
  // Canonical source_system tag list for the source_system dropdown.
  // Fetched once; ADMIN + so-full-edit-override roles can repoint.
  const [sourceSystems, setSourceSystems] = useState([]);

  useEffect(() => {
    api.get('/admin/source-systems', { silentPermissionDenied: true }).then(async (res) => {
      if (!res?.ok) return;
      const data = await res.json();
      setSourceSystems(data.source_systems || []);
    });
  }, []);

  async function loadSOIntoModal(so_id) {
    const [detailRes, relatedRes] = await Promise.all([
      api.get(`/admin/sales-orders/${so_id}`),
      api.get(`/admin/sales-orders/${so_id}/related`),
    ]);
    if (!detailRes?.ok) return false;
    const data = await detailRes.json();
    setSelectedSO(data.sales_order);
    setSOLines(data.lines || []);
    // A failed related call must not block the record itself from
    // opening; the tab renders its own unavailable state.
    setRelated(relatedRes?.ok ? await relatedRes.json() : null);
    setExpandedRelated([]);
    return true;
  }

  async function viewSO(so) {
    setSOTab('details');
    setRelatedNav([]);
    await loadSOIntoModal(so.so_id);
  }

  // Swap the modal to a related record, remembering where we came from so
  // the header's back arrow can return. Returns and refunds are filtered
  // out of this page's list entirely (exclude_post_fulfillment), so for
  // those this navigation is the only way to reach the record from its
  // original order -- it fetches by id and never needs a list row.
  async function viewRelated(record) {
    if (!selectedSO || record.so_id === selectedSO.so_id) return;
    const from = { so_id: selectedSO.so_id, so_number: selectedSO.so_number };
    const ok = await loadSOIntoModal(record.so_id);
    if (!ok) return;
    setRelatedNav((trail) => [...trail, from]);
    onNavigate?.(record.so_id);
    // Land on Details. The operator clicked a record to see what is on
    // it; leaving them on a near-identical family list would read as
    // nothing having happened.
    setSOTab('details');
  }

  async function backToPreviousRelated() {
    const previous = relatedNav[relatedNav.length - 1];
    if (!previous) return;
    const ok = await loadSOIntoModal(previous.so_id);
    if (!ok) return;
    setRelatedNav((trail) => trail.slice(0, -1));
    // Back returns them to the list they clicked from, which is the only
    // place this navigation can start.
    setSOTab('related');
  }

  function closeSOModal() {
    onClose?.();
    setSelectedSO(null);
    setSOLines([]);
    setRelated(null);
    setRelatedNav([]);
    setExpandedRelated([]);
    setSOTab('details');
  }

  function toggleRelatedLines(so_id) {
    setExpandedRelated((open) => (
      open.includes(so_id) ? open.filter((id) => id !== so_id) : [...open, so_id]
    ));
  }

  async function openEdit(so) {
    // Fetch the full SO with its lines so the modal can drive line
    // CRUD without a second round-trip. Falls back to the row-level
    // values if the detail call fails so the operator at least sees
    // the basic edit form.
    const res = await api.get(`/admin/sales-orders/${so.so_id}`);
    let full = so;
    let lines = [];
    let pickTasks = [];
    if (res?.ok) {
      const data = await res.json();
      full = data.sales_order || so;
      lines = data.lines || [];
      // so-refinement: pick_tasks in PICKED state. Populates the
      // status-revert modal when the operator demotes status.
      pickTasks = data.pick_tasks || [];
    }
    // Attach pick_tasks to the editing object so the revert modal can
    // read them without a second fetch.
    setEditing({ ...full, _pick_tasks: pickTasks });
    // so-refinement: address fields share editForm so the edit modal
    // can save header + addresses in one click. PATCH /address keeps
    // its own backend status gate; saveEdit fires it conditionally.
    const addressInit = {};
    for (const key of ADDRESS_FIELD_KEYS) addressInit[key] = full[key] || '';
    setEditForm({
      so_number: full.so_number || '',
      customer_name: full.customer_name || '',
      customer_phone: full.customer_phone || '',
      customer_email: full.customer_email || '',
      ship_address: full.ship_address || '',
      ship_method: full.ship_method || '',
      ship_by_date: full.ship_by_date ? full.ship_by_date.slice(0, 10) : '',
      memo: full.memo || '',
      status: full.status || 'OPEN',
      source_system: full.source_system || '',
      // mig 063: free-text upstream-origin label. Blank when the
      // connector mapping has not been wired up yet.
      order_origin: full.order_origin || '',
      // so-refinement: tracking_number defaults blank and prefills with
      // whatever dockd ship wrote (or whatever ADMIN backfilled).
      tracking_number: full.tracking_number || '',
      // Server-computed company-local Shipped Date (YYYY-MM-DD). Seeds
      // the date picker directly so it matches the read-only view.
      shipped_at: full.shipped_date_local || '',
      ...addressInit,
    });
    setEditLines(lines);
    setLineErrors({});
    setNewLineSku('');
    setNewLineQty('');
    setNewLineError('');
    setReleaseConfirm(null);
    setEditError('');
  }

  function closeEdit() {
    setEditing(null);
    setEditLines([]);
    setLineErrors({});
    setNewLineSku('');
    setNewLineQty('');
    setNewLineError('');
    setReleaseConfirm(null);
    setEditError('');
    setConfirmCancel(false);
    setRevertConfirm(null);
  }

  // Build the PUT body for header edits, optionally skipping the
  // status field (used when the status change has already gone through
  // the revert-status endpoint and only header sidecar fields remain).
  function _buildHeaderBody({ includeStatus }) {
    const body = {
      so_number: editForm.so_number,
      customer_name: editForm.customer_name || null,
      customer_phone: editForm.customer_phone || null,
      customer_email: editForm.customer_email || null,
      // ship_address deliberately omitted: the edit field is gone, and the
      // PUT skips keys it is not sent, so leaving it out avoids writing back
      // a value loaded at modal-open time over a newer one from the POS
      // phone-order path. The column stays live and operator-invisible.
      ship_method: editForm.ship_method || null,
      ship_by_date: editForm.ship_by_date || null,
      memo: editForm.memo || null,
    };
    if (includeStatus && editForm.status && editForm.status !== editing.status) {
      body.status = editForm.status;
    }
    const trackingTrimmed = (editForm.tracking_number || '').trim();
    if (trackingTrimmed !== (editing.tracking_number || '')) {
      body.tracking_number = trackingTrimmed || null;
    }
    // Shipped Date: send only when the operator actually changed it,
    // comparing against the server-computed company-local date. The
    // backend anchors the picked date at noon in the company timezone,
    // so dockd's precise ship instant is never clobbered by a routine
    // save. Empty clears to NULL.
    const shippedDate = (editForm.shipped_at || '').trim();
    if (shippedDate !== (editing.shipped_date_local || '')) {
      body.shipped_at = shippedDate || null;
    }
    if (hasSOFullEdit && editForm.source_system !== (editing.source_system || '')) {
      body.source_system = editForm.source_system || '';
    }
    // mig 063: same trim-and-diff treatment as source_system. Empty
    // string clears the column to NULL.
    const originTrimmed = (editForm.order_origin || '').trim();
    if (originTrimmed !== (editing.order_origin || '')) {
      body.order_origin = originTrimmed || null;
    }
    return body;
  }

  function _buildAddressBody() {
    const addressBody = {};
    let addressChanged = false;
    for (const key of ADDRESS_FIELD_KEYS) {
      const next = editForm[key] || '';
      const prev = editing[key] || '';
      if (next !== prev) addressChanged = true;
      addressBody[key] = next;
    }
    return { addressBody, addressChanged };
  }

  // Fires the header PUT and (if any field changed) the address PATCH.
  // Returns true on full success; on failure, sets editError and
  // returns false. Reused by both the no-revert path and the
  // post-revert path.
  async function _commitHeaderAndAddress({ includeStatus }) {
    const body = _buildHeaderBody({ includeStatus });
    const { addressBody, addressChanged } = _buildAddressBody();
    const putRes = await api.put(`/admin/sales-orders/${editing.so_id}`, body);
    if (!putRes?.ok) {
      let data = null;
      try { data = await putRes?.json(); } catch (_) { /* non-JSON body */ }
      setEditError(formatApiError(data, t('salesOrders.failedSave')));
      return false;
    }
    if (addressChanged) {
      const patchRes = await api.patch(
        `/admin/sales-orders/${editing.so_id}/address`,
        addressBody,
      );
      if (!patchRes?.ok) {
        let data = null;
        try { data = await patchRes?.json(); } catch (_) { /* non-JSON body */ }
        setEditError(formatApiError(data, t('salesOrders.failedSaveAddresses')));
        onChanged?.();
        return false;
      }
    }
    return true;
  }

  async function saveEdit() {
    setEditError('');
    // so-refinement: detect a backward status transition from
    // PICKED/PACKED/SHIPPED. The revert-status endpoint owns the pick /
    // pack / ship unwind, so we intercept here and let the operator
    // pick which pick_tasks release back to their source bin before the
    // status flip + sidecar header saves go through.
    const cur = editing.status;
    const next = editForm.status;
    if (
      cur && next && cur !== next
      && REVERTABLE_STATUSES.has(cur)
      && STATUS_ORDER[next] !== undefined
      && STATUS_ORDER[cur] !== undefined
      && STATUS_ORDER[next] < STATUS_ORDER[cur]
    ) {
      const pickTasks = editing._pick_tasks || [];
      setRevertConfirm({
        newStatus: next,
        currentStatus: cur,
        pickTasks,
        // Default: keep all (every row checked). Operator unchecks
        // the specific picks they want to release back to source bin.
        // If target < PICKED, the backend rejects while any keep
        // remains, so the operator sees the inconsistency before commit.
        keepIds: new Set(pickTasks.map((t) => t.pick_task_id)),
        error: '',
        busy: false,
      });
      return;
    }
    const ok = await _commitHeaderAndAddress({ includeStatus: true });
    if (!ok) return;
    closeEdit();
    onChanged?.();
  }

  // so-refinement: open the revert modal in release-only mode. No
  // status change implied; the modal posts new_status == current and
  // the backend skips the status update + audit row when nothing
  // changed. Default keep-all matches the revert-mode default;
  // operator unchecks the specific rows they want to release back
  // to bin.
  function openReleaseOnly(pickTasks) {
    if (!editing || !pickTasks.length) return;
    setRevertConfirm({
      newStatus: editing.status,
      currentStatus: editing.status,
      pickTasks,
      keepIds: new Set(pickTasks.map((t) => t.pick_task_id)),
      error: '',
      busy: false,
      mode: 'release-only',
    });
  }

  async function confirmRevertAndSave() {
    if (!revertConfirm) return;
    setRevertConfirm({ ...revertConfirm, error: '', busy: true });
    // Anything NOT in keepIds is released back to its source bin.
    const releaseIds = revertConfirm.pickTasks
      .filter((t) => !revertConfirm.keepIds.has(t.pick_task_id))
      .map((t) => t.pick_task_id);
    const revertRes = await api.post(
      `/admin/sales-orders/${editing.so_id}/revert-status`,
      {
        new_status: revertConfirm.newStatus,
        release_pick_task_ids: releaseIds,
      },
    );
    if (!revertRes?.ok) {
      let data = null;
      try { data = await revertRes?.json(); } catch (_) { /* non-JSON body */ }
      setRevertConfirm({
        ...revertConfirm,
        busy: false,
        error: data?.error || 'Failed to revert status',
      });
      return;
    }
    // Release-only mode: no status change, no in-flight header edits to
    // chain. Refresh the SO detail in place so quantity_picked +
    // pick_tasks reflect the release, then close the revert modal and
    // leave the main edit modal open for any further work.
    if (revertConfirm.mode === 'release-only') {
      const refresh = await api.get(`/admin/sales-orders/${editing.so_id}`);
      if (refresh?.ok) {
        const data = await refresh.json();
        setEditing({ ...(data.sales_order || editing), _pick_tasks: data.pick_tasks || [] });
        setEditLines(data.lines || []);
      }
      setRevertConfirm(null);
      onChanged?.();
      return;
    }
    // Status change committed via revert; commit any remaining header /
    // address edits (without re-sending status) and tear down.
    const ok = await _commitHeaderAndAddress({ includeStatus: false });
    if (!ok) {
      // Header save failed after revert succeeded. Status already
      // changed, so close the revert modal and let the operator see
      // the editError on the main modal.
      setRevertConfirm(null);
      onChanged?.();
      return;
    }
    closeEdit();
    onChanged?.();
  }

  // ── line CRUD ─────────────────────────────────────────────────────────────

  async function resolveSku(sku) {
    const key = String(sku || '').trim();
    if (!key) return null;
    const res = await api.get(
      `/admin/items?q=${encodeURIComponent(key)}&per_page=10&active=true`,
      { silentPermissionDenied: true },
    );
    if (!res?.ok) return null;
    const data = await res.json();
    return resolveItemFromScan(key, data.items || []);
  }

  async function addLine() {
    setNewLineError('');
    const sku = newLineSku.trim();
    const qty = parseInt(newLineQty, 10);
    if (!sku) { setNewLineError(t('salesOrders.enterSku')); return; }
    if (isNaN(qty) || qty <= 0) { setNewLineError(t('salesOrders.enterQty')); return; }
    setAddingLine(true);
    try {
      let item = resolvedItem;
      if (!item || String(item.sku).toLowerCase() !== sku.toLowerCase()) {
        item = await resolveSku(sku);
      }
      if (!item) { setNewLineError(t('salesOrders.unknownSku', { sku })); return; }
      const res = await api.post(
        `/admin/sales-orders/${editing.so_id}/lines`,
        { item_id: item.item_id, quantity_ordered: qty },
      );
      if (res?.ok) {
        const created = await res.json();
        setEditLines((ls) => [
          ...ls,
          { ...created, item_name: item.item_name, upc: item.upc },
        ]);
        setNewLineSku('');
        setNewLineQty('');
        setResolvedItem(null);
      } else {
        let data = null;
        try { data = await res?.json(); } catch (_) { /* non-JSON body */ }
        setNewLineError(formatApiError(data, t('salesOrders.failedAddLine')));
      }
    } finally {
      setAddingLine(false);
    }
  }

  // Commits a quantity_ordered edit. If new qty crosses below
  // quantity_allocated, we route through the release-confirm modal so
  // the operator explicitly acknowledges that pick-batch allocations
  // will be unwound.
  function requestLineQtyEdit(line, newQty) {
    if (newQty < (line.quantity_allocated || 0) && (line.quantity_allocated || 0) > 0) {
      setReleaseConfirm({ intent: 'shrink', line, newQty });
      return;
    }
    return commitLineQtyEdit(line, newQty);
  }

  async function commitLineQtyEdit(line, newQty) {
    setLineErrors((e) => ({ ...e, [line.so_line_id]: '' }));
    const res = await api.patch(
      `/admin/sales-orders/${editing.so_id}/lines/${line.so_line_id}`,
      { quantity_ordered: newQty },
    );
    if (res?.ok) {
      const data = await res.json();
      setEditLines((ls) => ls.map((l) =>
        l.so_line_id === line.so_line_id
          ? {
              ...l,
              quantity_ordered: newQty,
              // The server zeroes quantity_allocated when it releases.
              quantity_allocated: data.released_allocation > 0 ? 0 : l.quantity_allocated,
            }
          : l,
      ));
    } else {
      let data = null;
      try { data = await res?.json(); } catch (_) { /* non-JSON body */ }
      setLineErrors((e) => ({
        ...e,
        [line.so_line_id]: formatApiError(data, t('salesOrders.failedUpdate')),
      }));
    }
  }

  // Inline stepper for a line's standing reservation. Rarely needed -- the
  // picking flow normalizes reservations itself -- but lets an operator nudge
  // quantity_allocated by hand. The server clamps to [picked, ordered] and
  // reconciles inventory; we just reflect the value it returns.
  async function adjustLineAllocation(line, delta) {
    setLineErrors((e) => ({ ...e, [line.so_line_id]: '' }));
    const res = await api.patch(
      `/admin/sales-orders/${editing.so_id}/lines/${line.so_line_id}/allocation`,
      { delta },
    );
    if (res?.ok) {
      const data = await res.json();
      setEditLines((ls) => ls.map((l) =>
        l.so_line_id === line.so_line_id
          ? { ...l, quantity_allocated: data.quantity_allocated }
          : l,
      ));
    } else {
      let data = null;
      try { data = await res?.json(); } catch { /* non-JSON body */ }
      setLineErrors((e) => ({
        ...e,
        [line.so_line_id]: formatApiError(data, t('salesOrders.failedAdjustAlloc')),
      }));
    }
  }

  function requestRemoveLine(line) {
    if ((line.quantity_allocated || 0) > 0) {
      setReleaseConfirm({ intent: 'delete', line });
      return;
    }
    return commitRemoveLine(line);
  }

  async function commitRemoveLine(line) {
    setLineErrors((e) => ({ ...e, [line.so_line_id]: '' }));
    const res = await api.delete(
      `/admin/sales-orders/${editing.so_id}/lines/${line.so_line_id}`,
    );
    if (res?.ok) {
      setEditLines((ls) => ls.filter((l) => l.so_line_id !== line.so_line_id));
    } else {
      let data = null;
      try { data = await res?.json(); } catch (_) { /* non-JSON body */ }
      setLineErrors((e) => ({
        ...e,
        [line.so_line_id]: formatApiError(data, t('salesOrders.failedRemove')),
      }));
    }
  }

  async function confirmReleaseAndProceed() {
    const c = releaseConfirm;
    setReleaseConfirm(null);
    if (!c) return;
    if (c.intent === 'shrink') await commitLineQtyEdit(c.line, c.newQty);
    else if (c.intent === 'delete') await commitRemoveLine(c.line);
  }

  // ── Partial-fulfill ──────────────────────────────────────────────────────

  function openPartialFulfill() {
    // Seed the form with empty short_qty per pickable line so the
    // operator only needs to fill rows they actually want to short.
    // Pickable lines = quantity_ordered > quantity_picked (the spec's
    // PICKED-shorting validation; OPEN lines have quantity_picked=0).
    const shorts = {};
    for (const line of editLines || []) {
      const unshipped = (line.quantity_ordered || 0) - (line.quantity_picked || 0);
      if (unshipped > 0) shorts[line.so_line_id] = '';
    }
    setPartialForm({ shorts, reason: '' });
    setPartialError('');
    setPartialFulfilling(editing);
  }

  function closePartialFulfill() {
    setPartialFulfilling(null);
    setPartialForm({ shorts: {}, reason: '' });
    setPartialError('');
    setPartialSubmitting(false);
  }

  async function submitPartialFulfill() {
    setPartialError('');
    const lines = [];
    for (const [solId, raw] of Object.entries(partialForm.shorts)) {
      const qty = parseInt(raw, 10);
      if (!raw || isNaN(qty) || qty <= 0) continue;
      lines.push({ so_line_id: Number(solId), short_qty: qty });
    }
    if (lines.length === 0) {
      setPartialError(t('salesOrders.enterShortQty'));
      return;
    }
    setPartialSubmitting(true);
    try {
      const res = await api.post(
        `/admin/sales-orders/${partialFulfilling.so_id}/partial-fulfill`,
        { lines, reason_detail: partialForm.reason || undefined },
      );
      if (!res?.ok) {
        let data = null;
        try { data = await res?.json(); } catch (_) { /* non-JSON */ }
        setPartialError(formatApiError(data, t('salesOrders.failedPartial')));
        return;
      }
      const data = await res.json();
      const boNumber = data.backorder_so?.so_number || t('salesOrders.unknownBo');
      closePartialFulfill();
      closeEdit();
      onChanged?.({ message: t('salesOrders.backorderCreated', { bo: boNumber }) });
    } finally {
      setPartialSubmitting(false);
    }
  }

  // Admin virtual pick. Seeds one empty entry per unpicked line so
  // the operator only needs to fill the rows they want to pick now,
  // then fetches available bins per line in parallel. The endpoint
  // returns at most one entry per (line, bin) but the operator can
  // add a second entry on the same line to split a pick across two
  // bins -- bins remain reusable in the dropdown because the backend
  // sums per-line + per-bin at submit time.
  async function openAdminPick() {
    const form = {};
    const lineIds = [];
    for (const line of editLines || []) {
      const unpicked = (line.quantity_ordered || 0) - (line.quantity_picked || 0);
      if (unpicked > 0) {
        form[line.so_line_id] = [{ bin_id: '', quantity: '' }];
        lineIds.push(line.so_line_id);
      }
    }
    setAdminPickForm(form);
    setAdminPickBinsByLine({});
    setAdminPickError('');
    setAdminPicking(editing);

    const fetched = {};
    await Promise.all(lineIds.map(async (solId) => {
      const res = await api.get(
        `/admin/sales-orders/${editing.so_id}/lines/${solId}/available-bins`,
        { silentPermissionDenied: true },
      );
      if (res?.ok) {
        const data = await res.json();
        fetched[solId] = data.bins || [];
      } else {
        fetched[solId] = [];
      }
    }));
    setAdminPickBinsByLine(fetched);
  }

  function closeAdminPick() {
    setAdminPicking(null);
    setAdminPickForm({});
    setAdminPickBinsByLine({});
    setAdminPickError('');
    setAdminPickSubmitting(false);
  }

  function addAdminPickBin(solId) {
    setAdminPickForm((prev) => ({
      ...prev,
      [solId]: [...(prev[solId] || []), { bin_id: '', quantity: '' }],
    }));
  }

  function removeAdminPickBin(solId, idx) {
    setAdminPickForm((prev) => {
      const next = [...(prev[solId] || [])];
      next.splice(idx, 1);
      // Keep at least one row visible so the operator can re-add a
      // bin without re-opening the modal; an empty row is harmless
      // because the submit pass drops blanks before posting.
      return { ...prev, [solId]: next.length ? next : [{ bin_id: '', quantity: '' }] };
    });
  }

  function updateAdminPickField(solId, idx, field, value) {
    setAdminPickForm((prev) => {
      const next = [...(prev[solId] || [])];
      next[idx] = { ...next[idx], [field]: value };
      return { ...prev, [solId]: next };
    });
  }

  async function submitAdminPick() {
    setAdminPickError('');
    const lines = [];
    for (const [solId, entries] of Object.entries(adminPickForm)) {
      for (const e of entries) {
        const qty = parseInt(e.quantity, 10);
        const binId = parseInt(e.bin_id, 10);
        if (!e.bin_id || !binId || isNaN(qty) || qty <= 0) continue;
        lines.push({
          so_line_id: Number(solId),
          bin_id: binId,
          quantity: qty,
        });
      }
    }
    if (lines.length === 0) {
      setAdminPickError(t('salesOrders.pickAtLeastOne'));
      return;
    }
    setAdminPickSubmitting(true);
    try {
      const res = await api.post(
        `/admin/sales-orders/${adminPicking.so_id}/admin-pick`,
        { lines },
      );
      if (!res?.ok) {
        let data = null;
        try { data = await res?.json(); } catch (_) { /* non-JSON */ }
        setAdminPickError(formatApiError(data, t('salesOrders.adminPickFailed')));
        return;
      }
      const data = await res.json();
      closeAdminPick();
      closeEdit();
      const promoted = data.promoted_to_picked
        ? t('salesOrders.adminPickPromoted')
        : '';
      onChanged?.({ message: t('salesOrders.adminPickApplied', { n: data.picks_applied, promoted }) });
    } finally {
      setAdminPickSubmitting(false);
    }
  }

  // Lines this admin-ship would stamp: every line with picked > shipped. The
  // action ships all of them (no per-line selection) so the SO gets exactly
  // one fulfillment + one ship.confirmed; a partial ship would strand the rest.
  const adminShippableLines = (editLines || []).filter(
    (l) => (l.quantity_picked || 0) > (l.quantity_shipped || 0),
  );

  function openAdminShip() {
    setAdminShipError('');
    setAdminShipShortfall(null);
    setAdminShipping(editing);
  }

  function closeAdminShip() {
    setAdminShipping(null);
    setAdminShipError('');
    setAdminShipShortfall(null);
    setAdminShipSubmitting(false);
  }

  // acknowledgeShortfall=true re-submits past a silent-shortfall refusal, once
  // the operator has seen the blocking SKUs and chosen to ship the picked floor.
  async function submitAdminShip(acknowledgeShortfall = false) {
    setAdminShipError('');
    setAdminShipShortfall(null);
    setAdminShipSubmitting(true);
    try {
      const res = await api.post(
        `/admin/sales-orders/${adminShipping.so_id}/admin-ship`,
        { acknowledge_shortfall: acknowledgeShortfall },
      );
      if (!res?.ok) {
        let data = null;
        try { data = await res?.json(); } catch (_) { /* non-JSON */ }
        if (data?.kind === 'silent_shortfall') {
          // Offer the acknowledgement instead of a dead-end error.
          setAdminShipShortfall(data.lines || []);
          return;
        }
        setAdminShipError(formatApiError(data, t('salesOrders.adminShipFailed')));
        return;
      }
      const data = await res.json();
      closeAdminShip();
      closeEdit();
      onChanged?.({ message: t('salesOrders.adminShipApplied', { n: data.lines_shipped }) });
    } finally {
      setAdminShipSubmitting(false);
    }
  }

  async function cancelSO() {
    setEditError('');
    const res = await api.post(`/admin/sales-orders/${editing.so_id}/cancel`, {});
    if (res?.ok) {
      setConfirmCancel(false);
      setEditing(null);
      onChanged?.();
    } else {
      const data = await res?.json();
      setEditError(data?.error || t('salesOrders.failedCancel'));
      setConfirmCancel(false);
    }
  }

  // Open on soId. Re-runs when the parent points at a different order or
  // flips mode, so a page can swap between the view and edit surfaces
  // without unmounting the component.
  //
  // The load runs inside an async scope rather than straight in the effect
  // body: viewSO resets tab + nav state before its first await, and a
  // synchronous setState in an effect cascades a render. The cancelled flag
  // also drops a stale response if the parent points at another order while
  // the first fetch is still in flight.
  useEffect(() => {
    if (!soId) return undefined;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      if (mode === 'edit') await openEdit({ so_id: soId });
      else await viewSO({ so_id: soId });
    })();
    return () => { cancelled = true; };
  }, [soId, mode]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {selectedSO && (
        <Modal
          title={`SO ${selectedSO.so_number}`}
          onClose={closeSOModal}
          onBack={relatedNav.length ? backToPreviousRelated : undefined}
          backLabel={relatedNav.length ? relatedNav[relatedNav.length - 1].so_number : undefined}
          footer={
            <>
              {!['return', 'refund'].includes(selectedSO.order_type) &&
                soLines.some((l) => (l.quantity_shipped || 0) > 0) && (
                  <button
                    className="btn btn-primary"
                    onClick={() => setCreatingRma(true)}
                    data-testid="open-create-rma"
                  >
                    {t('salesOrders.createRma')}
                  </button>
                )}
              <button className="btn" onClick={closeSOModal}>{t('common.close')}</button>
            </>
          }
          size="wide"
        >
          <div className="data-tabs" style={{ marginBottom: 16 }}>
            <button
              type="button"
              className={`data-tab${soTab === 'details' ? ' active' : ''}`}
              onClick={() => setSOTab('details')}
              data-testid="so-tab-details"
            >
              {t('common.details')}
            </button>
            <button
              type="button"
              className={`data-tab${soTab === 'related' ? ' active' : ''}`}
              onClick={() => setSOTab('related')}
              data-testid="so-tab-related"
            >
              {t('salesOrders.relatedRecords', { count: related ? ` (${related.related_count})` : '' })}
            </button>
          </div>

          {soTab === 'related' ? (
            <RelatedRecordsTab
              related={related}
              expanded={expandedRelated}
              onToggleLines={toggleRelatedLines}
              onOpen={viewRelated}
            />
          ) : (
          <>
          <section className="section">
            <div className="section-title">{t('salesOrders.orderSummary')}</div>
            <div className="detail-grid detail-grid-2col" style={{ marginBottom: 0 }}>
              <span className="detail-label">{t('common.customer')}</span><span>{selectedSO.customer_name || '-'}</span>
              <span className="detail-label">{t('salesOrders.email')}</span><span>{selectedSO.customer_email || '-'}</span>
              <span className="detail-label">{t('common.status')}</span><span><StatusTag status={selectedSO.status} /></span>
              {/* mig 063: free-text upstream-origin label populated
                  by the inbound payload mapping. Right column, below
                  Status, above Ship Method. */}
              <span></span><span></span>
              <span className="detail-label">{t('salesOrders.source')}</span>
              <span><NullableValue value={selectedSO.order_origin} /></span>
              <span className="detail-label">{t('salesOrders.shipBy')}</span><span className="mono">{selectedSO.ship_by_date ? formatDateOnly(selectedSO.ship_by_date) : '-'}</span>
              {/* ship_method is the customer's requested service and is
                  never rewritten on ship; surface the authoritative carrier
                  when it contradicts the method (e.g. a USPS-named service
                  that shipped on a 1Z UPS label) so this line stops
                  contradicting the Tracking # below it. Display-only. */}
              <span className="detail-label">{t('salesOrders.shipMethod')}</span><span>{shipMethodDisplay(selectedSO).text}</span>
              {/* v1.8.0 (#282) per-order cost fields. order_total +
                  customer_shipping_paid arrive as strings on the wire to
                  preserve Decimal precision; render literal. */}
              <span className="detail-label">{t('salesOrders.orderTotal')}</span>
              <span className="mono"><NullableValue value={selectedSO.order_total != null ? `$${selectedSO.order_total}` : null} /></span>
              {/* so-refinement: tracking # in the right column directly
                  under Ship Method. */}
              <span className="detail-label">{t('salesOrders.tracking')}</span>
              <span className="mono"><NullableValue value={selectedSO.tracking_number} /></span>
              <span className="detail-label">{t('salesOrders.shippedDate')}</span>
              {/* shipped_date_local is the company-local date as
                  'YYYY-MM-DD'; parse at local midnight so toLocaleDateString
                  shows that exact calendar date in any browser timezone. */}
              <span className="mono">{selectedSO.shipped_date_local ? new Date(selectedSO.shipped_date_local + 'T00:00:00').toLocaleDateString() : '-'}</span>
              <span className="detail-label">{t('salesOrders.shippingPaid')}</span>
              <span className="mono"><NullableValue value={selectedSO.customer_shipping_paid != null ? `$${selectedSO.customer_shipping_paid}` : null} /></span>
              {/* so-refinement: legacy ship_address row dropped from
                  the Order Summary -- the structured Shipping Address
                  card below is the operator-facing source of truth.
                  The column itself stays populated for the mobile
                  pick/pack/ship floor screens that still read it. */}
            </div>
          </section>

          {/* v1.9.0 #315: free-text operator-facing note. Only shown
              when populated; render with whiteSpace: pre-wrap so
              embedded newlines from the source ERP survive. */}
          {selectedSO.memo && (
            <section className="section">
              <div style={{
                padding: 10,
                borderLeft: '3px solid var(--copper)', backgroundColor: 'var(--warning-bg)',
                whiteSpace: 'pre-wrap',
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--accent)',
                  letterSpacing: 0.4, marginBottom: 4,
                }}>NOTE</div>
                <div style={{ fontSize: 13, lineHeight: 1.4 }}>{selectedSO.memo}</div>
              </div>
            </section>
          )}

          {/* v1.8.0 (#268) per-component billing + shipping addresses.
              Each side gets its own card so a half-populated address
              renders cleanly without column shifts. so-refinement:
              address edits live in the main Edit modal now. */}
          <section className="section">
            <div className="section-title">{t('salesOrders.addresses')}</div>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
            }}>
              <div className="card">
                <div className="card-title">{t('salesOrders.billingAddress')}</div>
                <div className="detail-grid" style={{ marginBottom: 0 }}>
                  {ADDRESS_FIELD_KEYS.filter((k) => k.startsWith('billing_')).map((k) => (
                    <span key={k} style={{ display: 'contents' }}>
                      <span className="detail-label">{t(ADDRESS_FIELD_LABELS[k])}</span>
                      <span><NullableValue value={selectedSO[k]} /></span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="card">
                <div className="card-title">{t('salesOrders.shippingAddress')}</div>
                <div className="detail-grid" style={{ marginBottom: 0 }}>
                  {ADDRESS_FIELD_KEYS.filter((k) => k.startsWith('shipping_')).map((k) => (
                    <span key={k} style={{ display: 'contents' }}>
                      <span className="detail-label">{t(ADDRESS_FIELD_LABELS[k])}</span>
                      <span><NullableValue value={selectedSO[k]} /></span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="section" style={{ marginBottom: 0 }}>
            <div className="section-title">{t('salesOrders.lineItems')}</div>
            {soLines.length > 0 ? (
              <table className="lines-table">
                <thead>
                  <tr>
                    <th>{t('common.sku')}</th>
                    <th>{t('common.itemName')}</th>
                    <th style={{ textAlign: 'right' }}>{t('salesOrders.ordered')}</th>
                    <th style={{ textAlign: 'right' }}>{t('salesOrders.picked')}</th>
                    <th style={{ textAlign: 'right' }}>{t('salesOrders.shipped')}</th>
                  </tr>
                </thead>
                <tbody>
                  {soLines.map((l, i) => (
                    <tr key={i}>
                      <td className="mono">{l.sku}</td>
                      <td>{l.item_name}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{l.quantity_ordered}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{l.quantity_picked}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{l.quantity_shipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('salesOrders.noLineItems')}</p>
            )}
          </section>
          </>
          )}
        </Modal>
      )}

      {creatingRma && selectedSO && (
        <CreateRmaModal
          so={selectedSO}
          lines={soLines}
          onClose={() => setCreatingRma(false)}
          onCreated={(data) => {
            setCreatingRma(false);
            setSelectedSO(null);
            setSOLines([]);
            // onClose as well as onChanged: the parent still holds soId, and
            // without clearing it the open-on-soId effect will not re-fire
            // when the operator clicks the same order again.
            onClose?.();
            onChanged?.({ message: t('salesOrders.rmaCreated', { rma: data.so_number }) });
          }}
        />
      )}

      {editing && (() => {
        const status = editing.status;
        const headerEditable = isAdmin || hasSOFullEdit || status === 'OPEN';
        const lineEditable = headerEditable && !LINE_TERMINAL_STATUSES.has(status);
        const sourceSystemEditable = hasSOFullEdit;
        // so-refinement: PATCH /address gate is ADMIN any status,
        // non-admin only OPEN. Backend still enforces; this just keeps
        // the disabled state in sync so users don't try a save that
        // will 403.
        const addressEditable = isAdmin || status === 'OPEN';
        return (
          <Modal
            title={t('salesOrders.editTitle', { so: editing.so_number })}
            onClose={closeEdit}
            size="wide"
            footer={
              <>
                {status === 'OPEN' && (
                  <button className="btn btn-danger" onClick={() => setConfirmCancel(true)}>{t('salesOrders.cancelOrder')}</button>
                )}
                {/* Partial-fulfill. Status gate {OPEN, PICKED};
                    PICKED requires admin/so-full-edit so the button
                    hides for a base sales-orders USER on a PICKED SO
                    (the backend would 403 anyway). Type gate mirrors the
                    backend: allowed on every order_type EXCEPT return
                    (inbound RMA) and backorder (the one-level chaining
                    cap). replacement/exchange children ARE eligible. */}
                {['OPEN', 'PICKED'].includes(status)
                  && editing.order_type !== 'return'
                  && editing.order_type !== 'backorder'
                  && (isAdmin || hasSOFullEdit || status === 'OPEN') && (
                  <button
                    className="btn btn-warning"
                    onClick={openPartialFulfill}
                  >
                    {t('salesOrders.partiallyFulfill')}
                  </button>
                )}
                {/* Admin virtual pick: operator marks the SO picked
                    without the handheld. Gated to OPEN + ADMIN-or-
                    so-full-edit because the backend rejects every
                    other shape. Mirrors the backend gate exactly so
                    the button does not show when it would 403. */}
                {status === 'OPEN' && editing.order_type !== 'return' && (isAdmin || hasSOFullEdit) && (
                  <button
                    className="btn btn-warning"
                    onClick={openAdminPick}
                    title={t('salesOrders.adminPickTooltip')}
                  >
                    {t('salesOrders.adminPick')}
                  </button>
                )}
                {/* Admin ship: hand-stamp shipped qty on a picked-but-unshipped
                    order (incl. the stranded header-SHIPPED / line-shipped=0
                    case), so the Create RMA button renders. Shown only when a
                    line is actually shippable (picked > shipped) -- which also
                    hides it for already-shipped orders. Gated ADMIN-or-override
                    to mirror the backend. */}
                {['PICKED', 'PACKED', 'SHIPPED'].includes(status)
                  && editing.order_type !== 'return'
                  && (isAdmin || hasSOFullEdit)
                  && adminShippableLines.length > 0 && (
                  <button
                    className="btn btn-warning"
                    onClick={openAdminShip}
                    title={t('salesOrders.adminShipTooltip')}
                  >
                    {t('salesOrders.adminShip')}
                  </button>
                )}
                {/* so-refinement: shortcut to the release modal that
                    does not require flipping status first. Visible only
                    when the SO actually has picks in flight. */}
                {(editing._pick_tasks || []).length > 0 && editing.order_type !== 'return' && (
                  <button
                    className="btn"
                    onClick={() => openReleaseOnly(editing._pick_tasks || [])}
                    title={t('salesOrders.releasePickedTooltip')}
                  >{t('salesOrders.releasePicked')}</button>
                )}
                <button className="btn" onClick={closeEdit}>{t('common.cancel')}</button>
                <button className="btn btn-primary" onClick={saveEdit} disabled={!headerEditable}>{t('common.save')}</button>
              </>
            }
          >
            {editError && <div className="form-error" style={{ marginBottom: 12 }}>{editError}</div>}
            {!headerEditable && (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                {t('salesOrders.headerLocked', { status })}
              </p>
            )}
            {headerEditable && status !== 'OPEN' && (
              <p style={{ fontSize: 12, color: 'var(--copper)', marginBottom: 12 }}>
                {t('salesOrders.editingPastOpen', { status })}
              </p>
            )}
            <div className="form-row">
              <div className="form-group">
                <label>{t('salesOrders.number')}</label>
                <input className="form-input" disabled={!headerEditable} value={editForm.so_number} onChange={(e) => setEditForm({ ...editForm, so_number: e.target.value })} />
              </div>
              <div className="form-group">
                <label>{t('common.customer')}</label>
                <input className="form-input" disabled={!headerEditable} value={editForm.customer_name} onChange={(e) => setEditForm({ ...editForm, customer_name: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t('salesOrders.phone')}</label>
                <input className="form-input" disabled={!headerEditable} value={editForm.customer_phone} onChange={(e) => setEditForm({ ...editForm, customer_phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label>{t('salesOrders.email')}</label>
                <input className="form-input" type="email" disabled={!headerEditable} value={editForm.customer_email} onChange={(e) => setEditForm({ ...editForm, customer_email: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t('salesOrders.shipBy')}</label>
                <input className="form-input" type="date" disabled={!headerEditable} value={editForm.ship_by_date} onChange={(e) => setEditForm({ ...editForm, ship_by_date: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t('common.status')}</label>
                <select
                  className="form-select"
                  disabled={!headerEditable}
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                >
                  {EDITABLE_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>{t('salesOrders.sourceSystem')}</label>
                <select
                  className="form-select"
                  disabled={!sourceSystemEditable}
                  value={editForm.source_system || ''}
                  onChange={(e) => setEditForm({ ...editForm, source_system: e.target.value })}
                  title={t(sourceSystemEditable
                    ? 'salesOrders.reassignSource'
                    : 'salesOrders.reassignNeedsOverride')}
                >
                  <option value="">{t('salesOrders.none')}</option>
                  {sourceSystems.map((s) => (
                    <option key={s.source_system} value={s.source_system}>
                      {s.source_system} {s.kind ? `(${s.kind})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {/* mig 063: free-text upstream-origin label. No allowlist /
                dropdown -- the inbound payload populates it; ADMIN /
                so-full-edit can override. Empty string clears the column. */}
            <div className="form-group">
              <label>{t('salesOrders.source')}</label>
              <input
                className="form-input"
                disabled={!headerEditable}
                maxLength={64}
                placeholder={t('salesOrders.sourceExample')}
                value={editForm.order_origin}
                onChange={(e) => setEditForm({ ...editForm, order_origin: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>{t('salesOrders.shipMethod')}</label>
              <input className="form-input" disabled={!headerEditable} value={editForm.ship_method} onChange={(e) => setEditForm({ ...editForm, ship_method: e.target.value })} />
            </div>
            {/* so-refinement: Tracking # on its own row, right-aligned
                beneath Ship Method to match the view-modal layout. */}
            <div className="form-row">
              <div className="form-group" aria-hidden="true" />
              <div className="form-group">
                <label>{t('salesOrders.tracking')}</label>
                <input
                  className="form-input mono"
                  disabled={!headerEditable}
                  maxLength={128}
                  placeholder={t('salesOrders.trackingAutofill')}
                  value={editForm.tracking_number}
                  onChange={(e) => setEditForm({ ...editForm, tracking_number: e.target.value })}
                />
              </div>
            </div>
            {/* Shipped Date beneath Tracking #, matching the view-modal
                order. Auto-set by dockd ship; editable here to backfill
                orders shipped manually / via an external system. */}
            <div className="form-row">
              <div className="form-group" aria-hidden="true" />
              <div className="form-group">
                <label>{t('salesOrders.shippedDate')}</label>
                <input
                  className="form-input"
                  type="date"
                  disabled={!headerEditable}
                  value={editForm.shipped_at}
                  onChange={(e) => setEditForm({ ...editForm, shipped_at: e.target.value })}
                />
              </div>
            </div>
            <div className="form-group">
              <label>{t('salesOrders.memo')}</label>
              <textarea
                className="form-input" rows={3}
                placeholder="......"
                maxLength={4096}
                disabled={!headerEditable}
                value={editForm.memo}
                onChange={(e) => setEditForm({ ...editForm, memo: e.target.value })}
              />
            </div>

            {/* so-refinement: addresses live inside the edit modal now.
                Saved via PATCH /address from saveEdit when any of the 16
                fields changed. Empty string clears to NULL. */}
            <section className="section" style={{ marginTop: 16 }}>
              <div className="section-title">{t('salesOrders.addresses')}</div>
              {!addressEditable && (
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  {t('salesOrders.addressLocked', { status })}
                </p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <strong style={{ display: 'block', marginBottom: 8 }}>{t('salesOrders.billing')}</strong>
                  {ADDRESS_FIELD_KEYS.filter((k) => k.startsWith('billing_')).map((k) => (
                    <div key={k} className="form-group">
                      <label>{t(ADDRESS_FIELD_LABELS[k])}</label>
                      <input
                        className="form-input"
                        disabled={!addressEditable}
                        value={editForm[k] || ''}
                        onChange={(e) => setEditForm({ ...editForm, [k]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
                <div>
                  <strong style={{ display: 'block', marginBottom: 8 }}>{t('salesOrders.shipping')}</strong>
                  {ADDRESS_FIELD_KEYS.filter((k) => k.startsWith('shipping_')).map((k) => (
                    <div key={k} className="form-group">
                      <label>{t(ADDRESS_FIELD_LABELS[k])}</label>
                      <input
                        className="form-input"
                        disabled={!addressEditable}
                        value={editForm[k] || ''}
                        onChange={(e) => setEditForm({ ...editForm, [k]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="section" style={{ marginTop: 16 }}>
              <div className="section-title">{t('salesOrders.lineItems')}</div>
              {editLines.length > 0 ? (
                <table className="lines-table">
                  <thead>
                    <tr>
                      <th>{t('common.sku')}</th>
                      <th>{t('common.itemName')}</th>
                      <th style={{ textAlign: 'right' }}>{t('salesOrders.ordered')}</th>
                      <th style={{ textAlign: 'right' }}>{t('common.allocated')}</th>
                      <th style={{ textAlign: 'right' }}>{t('salesOrders.picked')}</th>
                      <th style={{ textAlign: 'right' }}>{t('salesOrders.shipped')}</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {editLines.map((l) => {
                      const removable = lineEditable
                        && (l.quantity_picked || 0) === 0
                        && (l.quantity_packed || 0) === 0
                        && (l.quantity_shipped || 0) === 0;
                      return (
                        <tr key={l.so_line_id}>
                          <td className="mono">{l.sku}</td>
                          <td>{l.item_name}</td>
                          <td style={{ textAlign: 'right' }}>
                            <LineQtyInput
                              line={l}
                              disabled={!lineEditable}
                              onCommit={requestLineQtyEdit}
                            />
                            {lineErrors[l.so_line_id] && (
                              <div className="form-error" style={{ fontSize: 11, marginTop: 4, textAlign: 'right' }}>
                                {lineErrors[l.so_line_id]}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <button
                                type="button"
                                className="btn btn-sm"
                                style={{ padding: '0 6px' }}
                                disabled={!lineEditable || (l.quantity_allocated || 0) <= (l.quantity_picked || 0)}
                                onClick={() => adjustLineAllocation(l, -1)}
                                title={t('salesOrders.releaseOneUnit')}
                                aria-label={t('salesOrders.decreaseAllocated')}
                              >-</button>
                              <span className="mono" style={{ minWidth: 20, textAlign: 'center' }}>{l.quantity_allocated || 0}</span>
                              <button
                                type="button"
                                className="btn btn-sm"
                                style={{ padding: '0 6px' }}
                                disabled={!lineEditable || (l.quantity_allocated || 0) >= (l.quantity_ordered || 0)}
                                onClick={() => adjustLineAllocation(l, 1)}
                                title={t('salesOrders.reserveOneUnit')}
                                aria-label={t('salesOrders.increaseAllocated')}
                              >+</button>
                            </span>
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>{l.quantity_picked || 0}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{l.quantity_shipped || 0}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => requestRemoveLine(l)}
                              disabled={!removable}
                              title={!removable
                                ? (LINE_TERMINAL_STATUSES.has(status)
                                  ? t('salesOrders.linesLocked', { status })
                                  : t('salesOrders.lineHasUnits'))
                                : t('salesOrders.removeLine')}
                              aria-label={t('salesOrders.removeLine')}
                            >&#10005;</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('salesOrders.noLineItemsYet')}</p>
              )}

              {lineEditable && (
                <div style={{
                  marginTop: 12, padding: 12,
                  background: 'var(--surface)',
                  borderRadius: 'var(--radius)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: '0 0 240px' }}>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>{t('common.sku')}</label>
                      <SkuBarcodeAutocomplete
                        className="form-input mono"
                        listId="so-edit-sku-suggestions"
                        minChars={2}
                        placeholder={t('skuSearch.placeholder')}
                        value={newLineSku}
                        onChange={setNewLineSku}
                        onItemSelect={setResolvedItem}
                        onKeyDown={(e) => { if (e.key === 'Enter') addLine(); }}
                        apiOptions={{ silentPermissionDenied: true }}
                        showNoMatch
                      />
                    </div>
                    <div style={{ flex: '0 0 120px' }}>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>{t('salesOrders.quantity')}</label>
                      <input
                        className="form-input"
                        type="number"
                        min={1}
                        placeholder="0"
                        value={newLineQty}
                        onChange={(e) => setNewLineQty(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') addLine(); }}
                      />
                    </div>
                    <div style={{ flexGrow: 1 }} />
                    <button
                      className="btn btn-primary"
                      onClick={addLine}
                      disabled={addingLine}
                      style={{ marginTop: 16 }}
                    >
                      {addingLine ? t('salesOrders.adding') : t('salesOrders.addLine')}
                    </button>
                  </div>
                  {newLineError && (
                    <div className="form-error" style={{ marginTop: 8, fontSize: 12 }}>
                      {newLineError}
                    </div>
                  )}
                  {!newLineError && resolvedItem && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--success)' }}>
                      <RichText
                        text={t('salesOrders.foundItem')}
                        values={{
                          sku: <strong>{resolvedItem.sku}</strong>,
                          name: resolvedItem.item_name,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </section>
          </Modal>
        );
      })()}

      {releaseConfirm && (
        <Modal
          title={t('salesOrders.releaseAllocTitle')}
          onClose={() => setReleaseConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setReleaseConfirm(null)}>{t('common.back')}</button>
              <button className="btn btn-danger" onClick={confirmReleaseAndProceed}>
                {t(releaseConfirm.intent === 'delete'
                  ? 'salesOrders.releaseAndRemove'
                  : 'salesOrders.releaseAndUpdate')}
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, marginBottom: 8 }}>
            <RichText
              text={t('salesOrders.lineAllocated')}
              values={{
                sku: <strong>{releaseConfirm.line.sku}</strong>,
                n: <strong>{releaseConfirm.line.quantity_allocated}</strong>,
              }}
            />
          </p>
          <p style={{ fontSize: 13, marginBottom: 8 }}>
            {releaseConfirm.intent === 'delete'
              ? t('salesOrders.releaseExplainDelete')
              : t('salesOrders.releaseExplainShrink', {
                qty: releaseConfirm.newQty,
                allocated: releaseConfirm.line.quantity_allocated,
              })}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('salesOrders.releaseAuditNote')}
          </p>
        </Modal>
      )}

      {confirmCancel && editing && (
        <Modal
          title={t('salesOrders.cancelOrderTitle', { so: editing.so_number })}
          onClose={() => setConfirmCancel(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmCancel(false)}>{t('salesOrders.keepOrder')}</button>
              <button className="btn btn-danger" onClick={cancelSO}>{t('salesOrders.cancelOrder')}</button>
            </>
          }
        >
          <p style={{ fontSize: 13 }}>
            {t('salesOrders.cancelConfirmBody')}
          </p>
        </Modal>
      )}

      {/* Partial-fulfill sub-modal. Renders on top of the SO edit
          modal; submit closes both. Per-line short_qty inputs gated
          by max = quantity_ordered - quantity_picked so the UI mirrors
          the server validation. */}
      {partialFulfilling && (
        <Modal
          title={t('salesOrders.partialTitle', { so: partialFulfilling.so_number })}
          onClose={closePartialFulfill}
          size="wide"
          footer={
            <>
              <button className="btn" onClick={closePartialFulfill} disabled={partialSubmitting}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-warning"
                onClick={submitPartialFulfill}
                disabled={partialSubmitting}
              >
                {partialSubmitting
                  ? t('salesOrders.creatingBackorder')
                  : t('salesOrders.shipAvailableCreateBo')}
              </button>
            </>
          }
        >
          {partialError && (
            <div className="form-error" style={{ marginBottom: 12 }}>{partialError}</div>
          )}
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            {t('salesOrders.partialHelp', { bo: `${partialFulfilling.so_number}-BO` })}
          </p>
          {(editLines || []).length === 0 ? (
            <p style={{ fontSize: 13 }}>{t('salesOrders.noLinesOnOrder')}</p>
          ) : (
            <table className="data-table" style={{ marginBottom: 12 }}>
              <thead>
                <tr>
                  <th>{t('salesOrders.line')}</th>
                  <th>{t('common.sku')}</th>
                  <th>{t('common.item')}</th>
                  <th style={{ textAlign: 'right' }}>{t('salesOrders.ordered')}</th>
                  <th style={{ textAlign: 'right' }}>{t('salesOrders.picked')}</th>
                  <th style={{ textAlign: 'right' }}>{t('salesOrders.unshipped')}</th>
                  <th style={{ width: 100 }}>{t('salesOrders.short')}</th>
                </tr>
              </thead>
              <tbody>
                {(editLines || []).map((line) => {
                  const unshipped = (line.quantity_ordered || 0) - (line.quantity_picked || 0);
                  const disabled = unshipped <= 0;
                  return (
                    <tr key={line.so_line_id}>
                      <td>{line.line_number}</td>
                      <td className="mono">{line.sku}</td>
                      <td>{line.item_name}</td>
                      <td style={{ textAlign: 'right' }}>{line.quantity_ordered}</td>
                      <td style={{ textAlign: 'right' }}>{line.quantity_picked}</td>
                      <td style={{ textAlign: 'right' }}>{unshipped}</td>
                      <td>
                        <input
                          type="number"
                          className="form-input"
                          min={0}
                          max={unshipped}
                          step={1}
                          disabled={disabled}
                          value={partialForm.shorts[line.so_line_id] ?? ''}
                          onChange={(e) => setPartialForm((prev) => ({
                            ...prev,
                            shorts: { ...prev.shorts, [line.so_line_id]: e.target.value },
                          }))}
                          placeholder={disabled ? '-' : '0'}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="form-group">
            <label>{t('salesOrders.reasonFreeText')}</label>
            <input
              className="form-input"
              value={partialForm.reason}
              onChange={(e) => setPartialForm((prev) => ({ ...prev, reason: e.target.value }))}
              placeholder={t('salesOrders.reasonExample')}
              maxLength={500}
            />
          </div>
        </Modal>
      )}

      {/* Admin virtual-pick sub-modal. Per-line bin dropdown + qty
          input. The "+ Another bin" button adds a second {bin, qty}
          row to the same line so the operator can split a pick across
          two bins in one submit. Available-bins dropdown is sorted
          preferred-first by the backend. Submit is all-or-nothing. */}
      {adminPicking && (
        <Modal
          title={t('salesOrders.adminPickTitle', { so: adminPicking.so_number })}
          onClose={closeAdminPick}
          size="wide"
          footer={
            <>
              <button className="btn" onClick={closeAdminPick} disabled={adminPickSubmitting}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-warning"
                onClick={submitAdminPick}
                disabled={adminPickSubmitting}
              >
                {adminPickSubmitting ? t('salesOrders.picking') : t('salesOrders.pick')}
              </button>
            </>
          }
        >
          {adminPickError && (
            <div className="form-error" style={{ marginBottom: 12 }}>{adminPickError}</div>
          )}
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            {t('salesOrders.adminPickHelp')}
          </p>
          {Object.keys(adminPickForm).length === 0 ? (
            <p style={{ fontSize: 13 }}>{t('salesOrders.everyLineFullyPicked')}</p>
          ) : (
            <table className="data-table" style={{ marginBottom: 12 }}>
              <thead>
                <tr>
                  <th>{t('salesOrders.line')}</th>
                  <th>{t('common.sku')}</th>
                  <th>{t('common.item')}</th>
                  <th style={{ textAlign: 'right' }}>{t('salesOrders.ordered')}</th>
                  <th style={{ textAlign: 'right' }}>{t('salesOrders.picked')}</th>
                  <th>{t('common.bin')}</th>
                  <th style={{ width: 100 }}>{t('common.qty')}</th>
                  <th style={{ width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {(editLines || []).flatMap((line) => {
                  const entries = adminPickForm[line.so_line_id];
                  if (!entries) return [];
                  const bins = adminPickBinsByLine[line.so_line_id] || [];
                  const unpicked = (line.quantity_ordered || 0) - (line.quantity_picked || 0);
                  return entries.map((entry, idx) => (
                    <tr key={`${line.so_line_id}-${idx}`}>
                      {idx === 0 ? (
                        <>
                          <td rowSpan={entries.length}>{line.line_number}</td>
                          <td rowSpan={entries.length} className="mono">{line.sku}</td>
                          <td rowSpan={entries.length}>{line.item_name}</td>
                          <td rowSpan={entries.length} style={{ textAlign: 'right' }}>{line.quantity_ordered}</td>
                          <td rowSpan={entries.length} style={{ textAlign: 'right' }}>{line.quantity_picked}</td>
                        </>
                      ) : null}
                      <td>
                        <select
                          className="form-select"
                          value={entry.bin_id}
                          onChange={(e) => updateAdminPickField(
                            line.so_line_id, idx, 'bin_id', e.target.value,
                          )}
                        >
                          <option value="">- choose a bin -</option>
                          {bins.map((b) => (
                            <option key={b.bin_id} value={b.bin_id}>
                              {b.bin_code}
                              {b.zone_name ? ` (${b.zone_name})` : ''}
                              {' '}- avail {b.quantity_available}
                              {b.preferred_priority != null ? ` ${t('salesOrders.preferredMark')}` : ''}
                            </option>
                          ))}
                        </select>
                        {bins.length === 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                            {t('salesOrders.noBinsWithStock')}
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          className="form-input"
                          min={1}
                          max={unpicked}
                          step={1}
                          value={entry.quantity}
                          onChange={(e) => updateAdminPickField(
                            line.so_line_id, idx, 'quantity', e.target.value,
                          )}
                          placeholder="0"
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => addAdminPickBin(line.so_line_id)}
                            title={t('salesOrders.pickFromSecondBin')}
                          >{t('salesOrders.addBin')}</button>
                          {entries.length > 1 && (
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => removeAdminPickBin(line.so_line_id, idx)}
                              title={t('salesOrders.dropBinEntry')}
                              aria-label={t('salesOrders.removeEntry')}
                            >&#10005;</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          )}
        </Modal>
      )}

      {adminShipping && (
        <Modal
          title={t('salesOrders.adminShipTitle', { so: adminShipping.so_number })}
          onClose={closeAdminShip}
          footer={
            <>
              <button className="btn" onClick={closeAdminShip} disabled={adminShipSubmitting}>
                {t('common.cancel')}
              </button>
              {adminShipShortfall ? (
                <button
                  className="btn btn-danger"
                  onClick={() => submitAdminShip(true)}
                  disabled={adminShipSubmitting}
                >
                  {adminShipSubmitting ? t('salesOrders.shippingProgress') : t('salesOrders.shipAnyway')}
                </button>
              ) : (
                <button
                  className="btn btn-warning"
                  onClick={() => submitAdminShip(false)}
                  disabled={adminShipSubmitting || adminShippableLines.length === 0}
                >
                  {adminShipSubmitting ? t('salesOrders.shippingProgress') : t('salesOrders.ship')}
                </button>
              )}
            </>
          }
        >
          {adminShipError && (
            <div className="form-error" style={{ marginBottom: 12 }}>{adminShipError}</div>
          )}
          {adminShipShortfall && (
            <div className="form-error" style={{ marginBottom: 12 }}>
              <strong>{t('salesOrders.underPicked')}</strong> {t('salesOrders.underPickedContinue')}
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {adminShipShortfall.map((l) => (
                  <li key={l.sku}>
                    <span className="mono">{l.sku}</span>: {t('salesOrders.shortfallLine', { ordered: l.ordered, picked: l.picked })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            {t('salesOrders.adminShipHelp')}
          </p>
          {adminShippableLines.length === 0 ? (
            <p style={{ fontSize: 13 }}>{t('salesOrders.nothingToShip')}</p>
          ) : (
            <table className="data-table" style={{ marginBottom: 12 }}>
              <thead>
                <tr>
                  <th>{t('salesOrders.line')}</th>
                  <th>{t('common.sku')}</th>
                  <th>{t('common.item')}</th>
                  <th style={{ textAlign: 'right' }}>{t('salesOrders.ordered')}</th>
                  <th style={{ textAlign: 'right' }}>{t('salesOrders.picked')}</th>
                  <th style={{ textAlign: 'right' }}>{t('salesOrders.willShip')}</th>
                </tr>
              </thead>
              <tbody>
                {adminShippableLines.map((line) => (
                  <tr key={line.so_line_id}>
                    <td>{line.line_number}</td>
                    <td className="mono">{line.sku}</td>
                    <td>{line.item_name}</td>
                    <td style={{ textAlign: 'right' }}>{line.quantity_ordered}</td>
                    <td style={{ textAlign: 'right' }}>{line.quantity_picked}</td>
                    <td style={{ textAlign: 'right' }}>
                      {(line.quantity_picked || 0) - (line.quantity_shipped || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}

      {revertConfirm && editing && (() => {
        const { newStatus, currentStatus, pickTasks, keepIds, error, busy, mode } = revertConfirm;
        const releaseOnly = mode === 'release-only';
        // No unship / unpack when target == current (release-only).
        const willUnship = !releaseOnly && currentStatus === 'SHIPPED';
        const willUnpack = !releaseOnly && (
          STATUS_ORDER[currentStatus] >= STATUS_ORDER.PACKED
          && STATUS_ORDER[newStatus] < STATUS_ORDER.PACKED
        );
        const targetBelowPicked = STATUS_ORDER[newStatus] < STATUS_ORDER.PICKED;
        // heldCount = picks the operator is keeping (checked). Those
        // block a target below PICKED since the SO would still have
        // quantity_picked on its lines.
        const heldCount = keepIds.size;
        const releaseCount = pickTasks.length - heldCount;
        const blockedByHeld = targetBelowPicked && heldCount > 0;
        const totalReleaseUnits = pickTasks
          .filter((t) => !keepIds.has(t.pick_task_id))
          .reduce((acc, t) => acc + (t.quantity_picked || 0), 0);
        function toggleId(id) {
          const next = new Set(keepIds);
          if (next.has(id)) next.delete(id); else next.add(id);
          setRevertConfirm({ ...revertConfirm, keepIds: next });
        }
        return (
          <Modal
            title={releaseOnly
              ? t('salesOrders.releasePickedTitle', { so: editing.so_number })
              : t('salesOrders.revertTitle', {
                so: editing.so_number,
                from: currentStatus,
                to: newStatus,
              })}
            onClose={() => setRevertConfirm(null)}
            size="wide"
            footer={
              <>
                <button className="btn" onClick={() => setRevertConfirm(null)} disabled={busy}>{t('common.back')}</button>
                <button
                  className="btn btn-primary"
                  onClick={confirmRevertAndSave}
                  disabled={busy || blockedByHeld}
                  title={blockedByHeld
                    ? t('salesOrders.cannotDemoteTooltip', { status: newStatus, held: heldCount })
                    : t('salesOrders.releaseUncheckedTooltip')}
                >
                  {busy ? t('salesOrders.reverting') : t('salesOrders.releaseAndSave')}
                </button>
              </>
            }
          >
            {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}

            {(willUnship || willUnpack) && (
              <div style={{
                padding: 10, marginBottom: 12,
                borderLeft: '3px solid var(--copper)', backgroundColor: 'var(--warning-bg)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--copper)', letterSpacing: 0.4, marginBottom: 4 }}>
                  {t('salesOrders.sideEffects')}
                </div>
                <ul style={{ fontSize: 13, lineHeight: 1.5, paddingLeft: 18, margin: 0 }}>
                  {willUnship && (
                    <li>
                      <strong>{t('salesOrders.unship')}</strong> {t('salesOrders.unshipDetail')}{' '}
                      {t('salesOrders.unshipDetail2')}
                    </li>
                  )}
                  {willUnpack && (
                    <li>
                      <strong>{t('salesOrders.unpack')}</strong> {t('salesOrders.unpackDetail')}
                      {t('salesOrders.unpackNoMoves')}
                    </li>
                  )}
                </ul>
              </div>
            )}

            <p style={{ fontSize: 13, marginBottom: 8 }}>
              {pickTasks.length === 0
                ? (
                  <>
                    {t('salesOrders.noPickedToRelease')}
                    {!releaseOnly && ` ${t('salesOrders.revertJustChangesStatus', {
                      extra: [
                        willUnpack ? t('salesOrders.andUnpack') : '',
                        willUnship ? t('salesOrders.andUnship') : '',
                      ].filter(Boolean).join(' '),
                    })}`}
                  </>
                )
                : (
                  <RichText
                    text={t('salesOrders.pickedTasksSummary')}
                    values={{
                      tasks: <strong>{pickTasks.length}</strong>,
                      units: (
                        <strong>
                          {pickTasks.reduce((acc, task) => acc + (task.quantity_picked || 0), 0)}
                        </strong>
                      ),
                      uncheck: <strong>{t('salesOrders.uncheck')}</strong>,
                    }}
                  />
                )}
            </p>

            {pickTasks.length > 0 && (
              <table className="lines-table" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th style={{ width: 56, textAlign: 'center' }}>{t('salesOrders.keep')}</th>
                    <th>{t('common.sku')}</th>
                    <th>{t('common.item')}</th>
                    <th>{t('common.bin')}</th>
                    <th style={{ textAlign: 'right' }}>{t('common.qty')}</th>
                    <th>{t('salesOrders.pickedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pickTasks.map((t) => (
                    <tr key={t.pick_task_id}>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={keepIds.has(t.pick_task_id)}
                          onChange={() => toggleId(t.pick_task_id)}
                          disabled={busy}
                          title={t('salesOrders.keepPickTooltip')}
                        />
                      </td>
                      <td className="mono">{t.sku}</td>
                      <td>{t.item_name}</td>
                      <td className="mono">{t.bin_code}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{t.quantity_picked}</td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {t.picked_at ? new Date(t.picked_at).toLocaleString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {blockedByHeld && (
              <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 12 }}>
                <RichText
                  text={t('salesOrders.blockedByHeld', { held: heldCount })}
                  values={{ status: <strong>{newStatus}</strong> }}
                />
              </p>
            )}
            {!blockedByHeld && pickTasks.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 12 }}>
                <RichText
                  text={t('salesOrders.releasingSummary', { total: pickTasks.length })}
                  values={{
                    count: <strong>{releaseCount}</strong>,
                    units: <strong>{totalReleaseUnits}</strong>,
                  }}
                />
              </p>
            )}
          </Modal>
        );
      })()}
    </>
  );
}

// Matches PurchaseOrders.LineQtyInput - inline qty input with on-blur
// commit so an Enter or click-away triggers the PATCH. Re-syncs to
// the parent's value after a successful update so a server-side rewrite
// (e.g. allocation release zeroing the line) reflects immediately.
function LineQtyInput({ line, disabled, onCommit }) {
  const { t } = useLocale();
  const [val, setVal] = useState(String(line.quantity_ordered));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setVal(String(line.quantity_ordered));
  }, [line.quantity_ordered]);

  async function commit() {
    const n = parseInt(val, 10);
    if (isNaN(n) || n <= 0 || n === line.quantity_ordered) {
      setVal(String(line.quantity_ordered));
      return;
    }
    setSaving(true);
    await onCommit(line, n);
    setSaving(false);
  }

  return (
    <input
      type="number"
      min={1}
      className="form-input mono"
      style={{ width: 88, textAlign: 'right', padding: '4px 8px' }}
      value={val}
      disabled={disabled || saving}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
    />
  );
}
