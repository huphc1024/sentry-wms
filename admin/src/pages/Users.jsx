import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import { useLocale } from '../i18n/locale.jsx';

const ROLES = ['ADMIN', 'USER'];

const ALL_FUNCTIONS = [
  { key: 'pick', labelKey: 'users.fnPick' },
  { key: 'pack', labelKey: 'users.fnPack' },
  { key: 'ship', labelKey: 'users.fnShip' },
  { key: 'receive', labelKey: 'users.fnReceive' },
  { key: 'putaway', labelKey: 'users.fnPutAway' },
  { key: 'count', labelKey: 'users.fnCount' },
  { key: 'transfer', labelKey: 'users.fnTransfer' },
  { key: 'map', labelKey: 'users.fnMap' },
  // Retail POS: the register gates login on this grant (ADMIN exempt). Grant it
  // to retail / customer-service accounts that should be able to sell.
  { key: 'sell', labelKey: 'users.fnSell' },
];

// Web-admin page grants (mig 061). Mirrors the sidebar
// groups so the create / edit modal feels familiar; keys match
// api/constants.py ALL_PAGE_KEYS exactly. ADMIN users bypass the
// permission table server-side, so checking these for an ADMIN is
// purely cosmetic - the PUT endpoint no-ops for ADMIN targets.

// Operational personas (Phase 6). DB still only has ADMIN|USER; presets
// fill allowed_functions + page_keys so go-live users match docs/role-matrix.md.
const ROLE_PRESETS = [
  {
    id: 'supervisor',
    labelKey: 'users.presetSupervisor',
    role: 'USER',
    allowed_functions: ALL_FUNCTIONS.map((fn) => fn.key),
    page_keys: [
      'dashboard', 'inventory', 'cycle-counts', 'count-approvals',
      'purchase-orders', 'receiving', 'putaway',
      'sales-orders', 'backorders', 'fraud', 'picking-tickets', 'picking-batches',
      'items', 'vendors', 'adjustments',
      'warehouses', 'bins', 'zones', 'preferred-bins',
      'pallets', 'expiry', 'warehouse-simulation',
      'notifications', 'audit-log',
    ],
  },
  {
    id: 'picker',
    labelKey: 'users.presetPicker',
    role: 'USER',
    allowed_functions: ['pick', 'pack', 'ship', 'map'],
    page_keys: ['dashboard', 'inventory', 'warehouse-simulation'],
  },
  {
    id: 'receiver',
    labelKey: 'users.presetReceiver',
    role: 'USER',
    allowed_functions: ['receive', 'putaway', 'map'],
    page_keys: [
      'dashboard', 'inventory', 'purchase-orders', 'receiving', 'putaway',
      'pallets', 'warehouse-simulation',
    ],
  },
];

const PAGE_GROUPS = [
  {
    labelKey: 'nav.floor',
    pages: [
      { key: 'dashboard', labelKey: 'nav.dashboard' },
      { key: 'inventory', labelKey: 'nav.inventory' },
      { key: 'warehouse-simulation', labelKey: 'users.pageWarehouseSimulation' },
      { key: 'cycle-counts', labelKey: 'users.pageCycleCounts' },
      { key: 'count-approvals', labelKey: 'users.pageCountApprovals' },
    ],
  },
  {
    labelKey: 'nav.inbound',
    pages: [
      { key: 'purchase-orders', labelKey: 'nav.purchaseOrders' },
      { key: 'receiving', labelKey: 'nav.receiving' },
      { key: 'putaway', labelKey: 'nav.putaway' },
    ],
  },
  {
    labelKey: 'nav.outbound',
    pages: [
      { key: 'sales-orders', labelKey: 'nav.salesOrders' },
      { key: 'backorders', labelKey: 'nav.backorders' },
      { key: 'fraud', labelKey: 'nav.fraud' },
      { key: 'picking-tickets', labelKey: 'nav.pickingTickets' },
      { key: 'picking-batches', labelKey: 'nav.pickingBatches' },
      { key: 'pos-activity', labelKey: 'nav.posActivity' },
    ],
  },
  {
    labelKey: 'nav.warehouse',
    pages: [
      { key: 'items', labelKey: 'nav.items' },
      { key: 'vendors', labelKey: 'nav.vendors' },
      { key: 'adjustments', labelKey: 'nav.adjustments' },
      { key: 'inter-warehouse-transfers', labelKey: 'nav.transfers' },
      { key: 'transfer-orders', labelKey: 'nav.transferOrders' },
      { key: 'warehouses', labelKey: 'nav.warehouses' },
      { key: 'bins', labelKey: 'nav.bins' },
      { key: 'zones', labelKey: 'nav.zones' },
      { key: 'preferred-bins', labelKey: 'nav.preferredBins' },
      { key: 'pallets', labelKey: 'nav.pallets' },
      { key: 'expiry', labelKey: 'nav.expiry' },
    ],
  },
  {
    labelKey: 'nav.system',
    pages: [
      { key: 'users', labelKey: 'nav.users' },
      { key: 'api-tokens', labelKey: 'nav.apiTokens' },
      { key: 'inbound', labelKey: 'nav.inboundActivity' },
      { key: 'consumer-groups', labelKey: 'nav.consumerGroups' },
      { key: 'webhooks', labelKey: 'nav.webhooks' },
      { key: 'channels', labelKey: 'nav.channels' },
      { key: 'notifications', labelKey: 'nav.notifications' },
      { key: 'audit-log', labelKey: 'nav.auditLog' },
      { key: 'imports', labelKey: 'users.pageImports' },
      { key: 'integrations', labelKey: 'nav.integrations' },
      { key: 'settings', labelKey: 'nav.settings' },
    ],
  },
  // Override grants (mig 062): feature-flag grants. Not pages in the
  // sidebar; granting one lifts the OPEN-only edit gate on the
  // matching admin surface (PO header/line edits past CLOSED+ARCHIVED;
  // SO header/line edits past OPEN). Same storage as page grants so
  // the multi-select reuses the existing pagePermissions array.
  {
    labelKey: 'users.groupOverrides',
    isOverride: true,
    pages: [
      { key: 'so-full-edit', labelKey: 'users.overrideSoFullEdit' },
      { key: 'warehouse-map-edit', labelKey: 'users.overrideMapEdit' },
    ],
  },
];

const ALL_PAGE_KEYS = PAGE_GROUPS.flatMap((g) => g.pages.map((p) => p.key));

export default function Users() {
  const { t } = useLocale();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  // mig 061: per-page web-admin grants. Edited inline alongside
  // the rest of the user form and saved via a follow-up PUT once the
  // user record itself lands.
  const [pagePermissions, setPagePermissions] = useState([]);

  useEffect(() => {
    loadUsers();
    loadWarehouses();
  }, []);

  async function loadUsers() {
    const res = await api.get('/admin/users');
    if (res?.ok) {
      const data = await res.json();
      setUsers(data.users || []);
    }
  }

  async function loadWarehouses() {
    const res = await api.get('/admin/warehouses', { silentPermissionDenied: true });
    if (res?.ok) {
      const data = await res.json();
      setWarehouses(data.warehouses || []);
    }
  }

  function openCreate() {
    setEditId(null);
    setForm({ role: 'USER', warehouse_ids: [], allowed_functions: [], is_active: true });
    setPagePermissions([]);
    setError('');
    setShowModal(true);
  }

  async function openEdit(user) {
    setEditId(user.user_id);
    setForm({
      ...user,
      password: '',
      warehouse_ids: user.warehouse_ids || [],
      allowed_functions: user.allowed_functions || [],
    });
    setError('');
    setShowModal(true);
    // Fetch the user's existing per-page grants so the modal can
    // populate the checkboxes. ADMINs return is_full_access=true
    // with the entire catalog, which we surface as "all checked".
    const res = await api.get(`/admin/users/${user.user_id}/permissions`);
    if (res?.ok) {
      const data = await res.json();
      setPagePermissions(data.page_keys || []);
    } else {
      setPagePermissions([]);
    }
  }

  function togglePagePermission(pageKey) {
    setPagePermissions((prev) => (
      prev.includes(pageKey)
        ? prev.filter((k) => k !== pageKey)
        : [...prev, pageKey]
    ));
  }

  function selectAllPagesInGroup(group) {
    setPagePermissions((prev) => {
      const next = new Set(prev);
      group.pages.forEach((p) => next.add(p.key));
      return Array.from(next);
    });
  }

  function clearPagesInGroup(group) {
    const groupKeys = new Set(group.pages.map((p) => p.key));
    setPagePermissions((prev) => prev.filter((k) => !groupKeys.has(k)));
  }

  function selectAllPages() {
    setPagePermissions([...ALL_PAGE_KEYS]);
  }

  function clearAllPages() {
    setPagePermissions([]);
  }

  function applyRolePreset(presetId) {
    const preset = ROLE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setForm((prev) => ({
      ...prev,
      role: preset.role,
      allowed_functions: [...preset.allowed_functions],
    }));
    setPagePermissions([...preset.page_keys]);
  }

  async function save() {
    setError('');
    // UpdateUserRequest does not accept `username` (the user_id is in the
    // URL path, and V-017 extras=forbid rejects unknown fields). Only
    // include it on the create path where CreateUserRequest expects it.
    const body = {
      full_name: form.full_name,
      role: form.role,
      warehouse_ids: form.warehouse_ids || [],
      allowed_functions: form.allowed_functions || [],
    };
    if (!editId) {
      body.username = form.username;
      body.password = form.password;
    } else if (form.password) {
      body.password = form.password;
    }
    const res = editId
      ? await api.put(`/admin/users/${editId}`, body)
      : await api.post('/admin/users', body);
    if (!res?.ok) {
      const data = await res?.json();
      setError(data?.error || 'Failed to save');
      return;
    }
    // Persist per-page grants in a follow-up PUT. The endpoint is a
    // no-op for ADMIN targets (server bypasses the table), so calling
    // it unconditionally is safe. Resolve the user_id from the
    // create response when we just minted a new row.
    const userPayload = await res.json().catch(() => null);
    const savedUserId = editId || userPayload?.user_id;
    if (savedUserId) {
      const permRes = await api.put(
        `/admin/users/${savedUserId}/permissions`,
        { page_keys: pagePermissions },
      );
      if (!permRes?.ok) {
        const permData = await permRes?.json();
        setError(
          permData?.error || 'User saved, but failed to save page permissions',
        );
        return;
      }
    }
    setShowModal(false);
    loadUsers();
  }

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

  async function deleteUser(id) {
    if (id === currentUser?.user_id) { setError(t('users.cannotDeleteSelf')); return; }
    setShowDeleteConfirm(id);
  }

  async function confirmDeleteUser() {
    const id = showDeleteConfirm;
    setShowDeleteConfirm(null);
    const res = await api.delete(`/admin/users/${id}`);
    if (res?.ok) {
      loadUsers();
    } else {
      const data = await res?.json();
      setError(data?.error || 'Failed to delete user');
    }
  }

  function toggleWarehouse(whId) {
    const ids = form.warehouse_ids || [];
    if (ids.includes(whId)) {
      setForm({ ...form, warehouse_ids: ids.filter((id) => id !== whId) });
    } else {
      setForm({ ...form, warehouse_ids: [...ids, whId] });
    }
  }

  function toggleFunction(fn) {
    const fns = form.allowed_functions || [];
    if (fns.includes(fn)) {
      setForm({ ...form, allowed_functions: fns.filter((f) => f !== fn) });
    } else {
      setForm({ ...form, allowed_functions: [...fns, fn] });
    }
  }

  function selectAllWarehouses() {
    setForm({
      ...form,
      warehouse_ids: warehouses.map((wh) => wh.warehouse_id),
    });
  }

  function clearWarehouses() {
    setForm({ ...form, warehouse_ids: [] });
  }

  function selectAllFunctions() {
    setForm({
      ...form,
      allowed_functions: ALL_FUNCTIONS.map((fn) => fn.key),
    });
  }

  function clearFunctions() {
    setForm({ ...form, allowed_functions: [] });
  }

  function warehouseCodes(warehouseIds) {
    if (!warehouseIds || warehouseIds.length === 0) return '-';
    return warehouseIds
      .map((id) => {
        const wh = warehouses.find((w) => w.warehouse_id === id);
        return wh ? wh.warehouse_code : id;
      })
      .join(', ');
  }

  const columns = [
    { key: 'username', labelKey: 'common.username', mono: true },
    { key: 'full_name', labelKey: 'common.fullName' },
    { key: 'role', labelKey: 'common.role' },
    { key: 'warehouse_ids', labelKey: 'users.warehouses', render: (r) => warehouseCodes(r.warehouse_ids) },
    { key: 'actions', label: '', render: (r) => (
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(r); }} aria-label={t('common.edit')} title={t('common.edit')}>&#9998;</button>
        {r.user_id !== currentUser?.user_id && (
          <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); deleteUser(r.user_id); }} aria-label={t('common.delete')} title={t('common.delete')}>&#128465;</button>
        )}
      </div>
    )},
  ];

  return (
    <div>
      <PageHeader title={t('nav.users')}>
        <button className="btn btn-primary" onClick={openCreate}>{t('users.newUser')}</button>
      </PageHeader>
      <DataTable rowKey="user_id" columns={columns} data={users} emptyMessageKey="users.noUsers" />

      {showModal && (
        <Modal title={editId ? t('users.editUser') : t('users.newUser')} onClose={() => setShowModal(false)}
          size="wide"
          footer={
            <>
              <button className="btn" onClick={() => setShowModal(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
            </>
          }
        >
          {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="form-row">
            <div className="form-group">
              <label>{t('common.username')}</label>
              <input className="form-input" value={form.username || ''} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('common.fullName')}</label>
              <input className="form-input" value={form.full_name || ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>{editId ? t('users.newPasswordHint') : t('common.password')}</label>
            <input className="form-input" type="password" value={form.password || ''} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="form-group">
            <label>{t('common.role')}</label>
            <select className="form-select" value={form.role || ''} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>{t('users.applyPreset')}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 0' }}>
              {ROLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => applyRolePreset(preset.id)}
                  title={t('users.presetTooltip')}
                >
                  {t(preset.labelKey)}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
              {t('users.presetNote')}
            </p>
          </div>
          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label>{t('users.warehouses')}</label>
              {warehouses.length > 0 && (
                <span style={{ fontSize: 12 }}>
                  <button
                    type="button"
                    onClick={selectAllWarehouses}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: 12 }}
                  >
                    {t('users.selectAll')}
                  </button>
                  <span style={{ color: 'var(--text-tertiary)', margin: '0 6px' }}>/</span>
                  <button
                    type="button"
                    onClick={clearWarehouses}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: 12 }}
                  >
                    {t('users.clear')}
                  </button>
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0' }}>
              {warehouses.map((wh) => (
                <label key={wh.warehouse_id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={(form.warehouse_ids || []).includes(wh.warehouse_id)}
                    onChange={() => toggleWarehouse(wh.warehouse_id)}
                  />
                  <span className="mono">{wh.warehouse_code}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{wh.warehouse_name}</span>
                </label>
              ))}
              {warehouses.length === 0 && <span style={{ color: 'var(--text-secondary)' }}>{t('users.noWarehouses')}</span>}
            </div>
          </div>
          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label>{t('users.mobileModules')}</label>
              <span style={{ fontSize: 12 }}>
                <button
                  type="button"
                  onClick={selectAllFunctions}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: 12 }}
                >
                  {t('users.selectAll')}
                </button>
                <span style={{ color: 'var(--text-tertiary)', margin: '0 6px' }}>/</span>
                <button
                  type="button"
                  onClick={clearFunctions}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: 12 }}
                >
                  {t('users.clear')}
                </button>
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '8px 0' }}>
              {ALL_FUNCTIONS.map((fn) => (
                <label key={fn.key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', minWidth: 100 }}>
                  <input
                    type="checkbox"
                    checked={(form.allowed_functions || []).includes(fn.key)}
                    onChange={() => toggleFunction(fn.key)}
                  />
                  {t(fn.labelKey)}
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label>{t('users.webPages')}</label>
              <span style={{ fontSize: 12 }}>
                <button
                  type="button"
                  onClick={selectAllPages}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: 12 }}
                >
                  {t('users.selectAll')}
                </button>
                <span style={{ color: 'var(--text-tertiary)', margin: '0 6px' }}>/</span>
                <button
                  type="button"
                  onClick={clearAllPages}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: 12 }}
                >
                  {t('users.clear')}
                </button>
              </span>
            </div>
            {form.role === 'ADMIN' ? (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '8px 0' }}>
                {t('users.adminBypass')}
              </p>
            ) : (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12, padding: '8px 0',
              }}>
                {PAGE_GROUPS.map((group) => {
                  const groupKeys = new Set(group.pages.map((p) => p.key));
                  const grantedCount = pagePermissions.filter((k) => groupKeys.has(k)).length;
                  // The Overrides card carries an accent border so it
                  // reads as a grant of authority, not a page-access
                  // toggle. Granting an override is a different mental
                  // model from picking which pages a USER can open.
                  const cardStyle = group.isOverride
                    ? { padding: 10, borderLeft: '3px solid var(--copper)' }
                    : { padding: 10 };
                  return (
                    <div key={group.labelKey} className="card" style={cardStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: group.isOverride ? 'var(--copper)' : undefined }}>
                          {t(group.labelKey)}
                        </strong>
                        <span style={{ fontSize: 11 }}>
                          <button
                            type="button"
                            onClick={() => selectAllPagesInGroup(group)}
                            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: 11 }}
                          >
                            {t('common.all')}
                          </button>
                          <span style={{ color: 'var(--text-tertiary)', margin: '0 4px' }}>/</span>
                          <button
                            type="button"
                            onClick={() => clearPagesInGroup(group)}
                            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: 11 }}
                          >
                            {t('common.none')}
                          </button>
                        </span>
                      </div>
                      {group.pages.map((p) => (
                        <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', cursor: 'pointer', fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={pagePermissions.includes(p.key)}
                            onChange={() => togglePagePermission(p.key)}
                          />
                          {t(p.labelKey)}
                        </label>
                      ))}
                      {grantedCount > 0 && grantedCount < group.pages.length && (
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
                          {grantedCount} / {group.pages.length}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Modal>
      )}

      {showDeleteConfirm && (
        <Modal title={t('users.deleteUser')} onClose={() => setShowDeleteConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setShowDeleteConfirm(null)}>{t('common.cancel')}</button>
              <button className="btn btn-danger" onClick={confirmDeleteUser}>{t('common.delete')}</button>
            </>
          }
        >
          <p style={{ fontSize: 14, marginBottom: 8 }}>{t('common.areYouSure')}</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('users.deleteWarning')}</p>
        </Modal>
      )}
    </div>
  );
}
