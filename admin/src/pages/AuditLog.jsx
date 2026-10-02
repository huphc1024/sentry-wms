import { useState, useEffect, useMemo } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import SkuBarcodeAutocomplete from '../components/SkuBarcodeAutocomplete.jsx';
import { useLocale } from '../i18n/locale.jsx';

// Action-type categorization drives the badge color in the table and
// modal header. Categories map to existing tag-* classes in App.css so
// the audit log shares a vocabulary with the rest of the admin (status
// chips, etc.). Unknown actions fall back to tag-gray so a future
// constant added without updating this map still renders sensibly.
const ACTION_CATEGORY = {
  RECEIVE: 'lifecycle', PUTAWAY: 'lifecycle', PICK: 'lifecycle',
  PACK: 'lifecycle', SHIP: 'lifecycle', TRANSFER: 'lifecycle',
  COUNT: 'success', ADJUST: 'warning',
  RECEIVE_CANCEL: 'warning', SHIP_VOID: 'warning', CANCEL: 'warning',
  TOKEN_ISSUE: 'security', TOKEN_ROTATE: 'security',
  TOKEN_REVOKE: 'security', TOKEN_DELETE: 'danger',
  WEBHOOK_SUBSCRIPTION_CREATE: 'config',
  WEBHOOK_SUBSCRIPTION_UPDATE: 'config',
  WEBHOOK_SUBSCRIPTION_DELETE_SOFT: 'warning',
  WEBHOOK_SUBSCRIPTION_DELETE_HARD: 'danger',
  WEBHOOK_SUBSCRIPTION_AUTO_PAUSE: 'warning',
  WEBHOOK_SECRET_ROTATE: 'security',
  WEBHOOK_DELIVERY_REPLAY_SINGLE: 'config',
  WEBHOOK_DELIVERY_REPLAY_BATCH: 'config',
  CONNECTOR_REGISTRY_CREATE: 'config',
  CONNECTOR_REGISTRY_UPDATE: 'config',
  CONNECTOR_REGISTRY_DELETE: 'warning',
  CONSUMER_GROUP_CREATE: 'config',
  CONSUMER_GROUP_UPDATE: 'config',
  CONSUMER_GROUP_DELETE: 'warning',
  SO_ADDRESS_EDITED: 'config',
  TO_CREATED: 'lifecycle', TO_LINE_PICKED: 'lifecycle',
  TO_SUBMITTED: 'lifecycle', TO_APPROVED: 'success',
  TO_REJECTED: 'warning', TO_LINE_SHORT_CLOSED: 'warning',
  TO_CANCELLED: 'warning', TO_DELETED: 'warning',
  TO_CLOSED: 'success',
};

const CATEGORY_TAG_CLASS = {
  lifecycle: 'tag-info',
  security: 'tag-purple',
  config: 'tag-gray',
  warning: 'tag-warning',
  danger: 'tag-danger',
  success: 'tag-success',
};

const ACTION_OPTIONS = [
  { value: '', labelKey: 'auditLog.allActions' },
  ...Object.keys(ACTION_CATEGORY).sort().map((a) => ({ value: a, label: a })),
];

const FILTER_LABEL_STYLE = {
  display: 'block', fontSize: 10, fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: 4,
  textTransform: 'uppercase', letterSpacing: 0.5,
};

function fmtTimestamp(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function parseDetails(raw) {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function formatValue(v) {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function ActionBadge({ action }) {
  const category = ACTION_CATEGORY[action] || 'config';
  return (
    <span
      className={`tag ${CATEGORY_TAG_CLASS[category]}`}
      style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 0.4 }}
    >
      {action}
    </span>
  );
}

function EntityCell({ row }) {
  if (!row.entity_type) {
    return <span style={{ color: 'var(--text-tertiary)' }}>-</span>;
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{
        fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
        textTransform: 'uppercase', letterSpacing: 0.4,
      }}>
        {row.entity_type}
      </span>
      {row.entity_name && (
        <span className="mono" style={{ fontSize: 12 }}>{row.entity_name}</span>
      )}
    </div>
  );
}

function DetailsChips({ row }) {
  const { t } = useLocale();
  const parsed = useMemo(() => parseDetails(row.details), [row.details]);
  if (!parsed || Object.keys(parsed).length === 0) {
    return <span style={{ color: 'var(--text-tertiary)' }}>-</span>;
  }
  const entries = Object.entries(parsed);
  const visible = entries.slice(0, 3);
  const overflow = entries.length - visible.length;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {visible.map(([k, v]) => (
        <span key={k} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 4, padding: '1px 6px', fontSize: 11,
          maxWidth: 240, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          <span style={{ color: 'var(--text-secondary)' }}>{k}</span>
          <span className="mono" style={{
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {formatValue(v)}
          </span>
        </span>
      ))}
      {overflow > 0 && (
        <span style={{
          fontSize: 11, color: 'var(--text-tertiary)',
          alignSelf: 'center', fontStyle: 'italic',
        }}>
          {t('auditLog.andMore', { n: overflow })}
        </span>
      )}
    </div>
  );
}

// Top-level tab switch. The Audit Log page historically opened on the
// full audit feed; Item History is the default tab so a supervisor
// chasing a SKU lands directly on the per-item lifecycle view.
// Switching to the 'audit' tab restores the original full feed.
export default function AuditLog() {
  const { t } = useLocale();
  const [tab, setTab] = useState('item-history');
  return (
    <div>
      <PageHeader title={t('nav.auditLog')} />
      <div className="data-tabs" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={`data-tab${tab === 'item-history' ? ' active' : ''}`}
          onClick={() => setTab('item-history')}
        >
          {t('auditLog.itemHistory')}
        </button>
        <button
          type="button"
          className={`data-tab${tab === 'audit' ? ' active' : ''}`}
          onClick={() => setTab('audit')}
        >
          {t('nav.auditLog')}
        </button>
      </div>
      {tab === 'item-history' ? <ItemHistoryView /> : <FullAuditLogView />}
    </div>
  );
}

function ItemHistoryView() {
  const { t } = useLocale();
  // SKU typeahead -> resolve to item_id -> /admin/audit-log?item_id=<id>.
  // Two-character minimum keeps the catalog from returning a huge result
  // set on a single-letter prefix; the dropdown caps at 25.
  const [itemSearch, setItemSearch] = useState('');
  const [itemSearching, setItemSearching] = useState(false);
  const [item, setItem] = useState(null);
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    if (!item) {
      setLogs([]);
      setPagination(null);
      return;
    }
    loadHistory();
  }, [item, page, sortKey, sortDir]);  // eslint-disable-line react-hooks/exhaustive-deps

  async function loadHistory() {
    setLoading(true);
    const params = new URLSearchParams({
      page, per_page: 50, item_id: item.item_id,
      sort_by: sortKey, sort_direction: sortDir,
    });
    const res = await api.get(`/admin/audit-log?${params}`);
    if (res?.ok) {
      const data = await res.json();
      setLogs(data.entries || []);
      setPagination({
        page: data.page, pages: data.pages,
        total: data.total, per_page: data.per_page,
      });
    }
    setLoading(false);
  }

  function pickItem(it) {
    setItem(it);
    setItemSearch(it.sku || '');
    setPage(1);
  }

  function clearItem() {
    setItem(null);
    setItemSearch('');
    setLogs([]);
    setPagination(null);
    setPage(1);
  }

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  }

  return (
    <div>
      <div style={{
        position: 'relative', marginBottom: 16, maxWidth: 480,
      }}>
        <label style={FILTER_LABEL_STYLE}>
          {t('common.sku')}{' '}
          {itemSearching && (
            <span style={{ textTransform: 'none', fontWeight: 400 }}>
              {t('interTransfers.searching')}
            </span>
          )}
        </label>
        <div style={{ display: 'flex', gap: 8, flex: 1 }}>
          <SkuBarcodeAutocomplete
            listId="audit-log-item-options"
            minChars={2}
            perPage={25}
            placeholder={t('skuSearch.placeholderMin2')}
            value={itemSearch}
            onChange={(v) => { setItemSearch(v); if (item) setItem(null); }}
            onItemSelect={(it) => { if (it) pickItem(it); }}
            onSearchingChange={setItemSearching}
            apiOptions={{ silentPermissionDenied: true }}
            showNoMatch={!item}
          />
          {item && (
            <button className="btn btn-sm" onClick={clearItem}>{t('webhooks.clearFilters')}</button>
          )}
        </div>
      </div>

      {!item && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Type a SKU or item name above to see every audit-log event
          that touched it (receives, picks, packs, ships, adjustments,
          transfers).
        </p>
      )}

      {item && (
        <AuditTable
          logs={logs}
          pagination={pagination}
          onPageChange={setPage}
          onRowClick={setSelected}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          emptyMessage={
            loading
              ? t('common.loading')
              : t('auditLog.noEventsFor', { sku: item.sku })
          }
        />
      )}

      {selected && (
        <AuditDetailModal entry={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function FullAuditLogView() {
  const { t } = useLocale();
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    action_type: '', user_id: '', start_date: '', end_date: '',
  });
  const [selected, setSelected] = useState(null);
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadLogs(); }, [page, filters, sortKey, sortDir]);

  async function loadLogs() {
    setLoading(true);
    const params = new URLSearchParams({ page, per_page: 50 });
    if (filters.action_type) params.set('action_type', filters.action_type);
    if (filters.user_id) params.set('user_id', filters.user_id);
    if (filters.start_date) params.set('start_date', filters.start_date);
    if (filters.end_date) params.set('end_date', filters.end_date);
    params.set('sort_by', sortKey);
    params.set('sort_direction', sortDir);
    const res = await api.get(`/admin/audit-log?${params}`);
    if (res?.ok) {
      const data = await res.json();
      setLogs(data.entries || []);
      setPagination({
        page: data.page, pages: data.pages,
        total: data.total, per_page: data.per_page,
      });
    }
    setLoading(false);
  }

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters({ action_type: '', user_id: '', start_date: '', end_date: '' });
    setPage(1);
  }

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  }

  const hasFilters = !!(
    filters.action_type || filters.user_id ||
    filters.start_date || filters.end_date
  );

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap',
        padding: 12, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 6,
        marginBottom: 16,
      }}>
        <div style={{ minWidth: 200 }}>
          <label style={FILTER_LABEL_STYLE}>{t('auditLog.action')}</label>
          <select
            className="form-select"
            value={filters.action_type}
            onChange={(e) => updateFilter('action_type', e.target.value)}
          >
            {ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 140 }}>
          <label style={FILTER_LABEL_STYLE}>{t('dashboard.user')}</label>
          <input
            className="form-input"
            placeholder={t('auditLog.usernamePlaceholder')}
            value={filters.user_id}
            onChange={(e) => updateFilter('user_id', e.target.value)}
          />
        </div>
        <div>
          <label style={FILTER_LABEL_STYLE}>{t('webhooks.from')}</label>
          <input
            className="form-input"
            type="date"
            value={filters.start_date}
            onChange={(e) => updateFilter('start_date', e.target.value)}
          />
        </div>
        <div>
          <label style={FILTER_LABEL_STYLE}>{t('webhooks.to')}</label>
          <input
            className="form-input"
            type="date"
            value={filters.end_date}
            onChange={(e) => updateFilter('end_date', e.target.value)}
          />
        </div>
        {hasFilters && (
          <button className="btn btn-sm" onClick={clearFilters}>{t('webhooks.clearFilters')}</button>
        )}
      </div>

      <AuditTable
        logs={logs}
        pagination={pagination}
        onPageChange={setPage}
        onRowClick={setSelected}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        emptyMessage={
          loading
            ? 'Loading…'
            : (hasFilters
                ? 'No entries match the current filters.'
                : 'No audit log entries yet.')
        }
      />

      {selected && (
        <AuditDetailModal entry={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

const AUDIT_COLUMNS = [
  {
    key: 'created_at',
    labelKey: 'auditLog.when',
    sortable: true,
    render: (r) => (
      <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {fmtTimestamp(r.created_at)}
      </span>
    ),
  },
  {
    key: 'action_type',
    labelKey: 'auditLog.action',
    sortable: true,
    render: (r) => <ActionBadge action={r.action_type} />,
  },
  {
    key: 'entity_type',
    labelKey: 'auditLog.entity',
    sortable: true,
    render: (r) => <EntityCell row={r} />,
  },
  {
    key: 'user_id',
    labelKey: 'dashboard.user',
    sortable: true,
    render: (r) => (
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
        <span className="mono" style={{ fontSize: 12 }}>
          {r.username || r.user_id || '-'}
        </span>
        {r.warehouse_code && (
          <span style={{
            fontSize: 10, color: 'var(--text-tertiary)',
            fontFamily: 'var(--mono)',
          }}>
            @{r.warehouse_code}
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'details',
    labelKey: 'common.details',
    render: (r) => <DetailsChips row={r} />,
  },
];

function AuditTable({
  logs, pagination, onPageChange, onRowClick,
  sortKey, sortDir, onSort, emptyMessage,
}) {
  return (
    <DataTable
      columns={AUDIT_COLUMNS}
      data={logs}
      pagination={pagination}
      onPageChange={onPageChange}
      onRowClick={onRowClick}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
      emptyMessage={emptyMessage}
    />
  );
}

function AuditDetailModal({ entry, onClose }) {
  const { t } = useLocale();
  const details = parseDetails(entry.details);
  const hasDetails = details && Object.keys(details).length > 0;

  function copyJson() {
    if (!hasDetails) return;
    navigator.clipboard?.writeText(JSON.stringify(details, null, 2));
  }

  return (
    <Modal
      title={t('auditLog.entryTitle')}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>{t('common.close')}</button>}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        marginBottom: 14, paddingBottom: 12,
        borderBottom: '1px solid var(--border)',
      }}>
        <ActionBadge action={entry.action_type} />
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {fmtTimestamp(entry.created_at)}
        </span>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '110px 1fr',
        gap: '8px 14px', fontSize: 13, marginBottom: 16,
      }}>
        <KV label={t('auditLog.entity')}>
          <EntityCell row={entry} />
          {entry.entity_id ? (
            <span className="mono" style={{
              fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 6,
            }}>
              id {entry.entity_id}
            </span>
          ) : null}
        </KV>
        <KV label={t('dashboard.user')}>
          <span className="mono">{entry.username || entry.user_id || '-'}</span>
        </KV>
        {entry.device_id && (
          <KV label={t('auditLog.device')}>
            <span className="mono" style={{ fontSize: 12 }}>{entry.device_id}</span>
          </KV>
        )}
        {entry.warehouse_code && (
          <KV label={t('common.warehouse')}>
            <span className="mono" style={{ fontSize: 12 }}>{entry.warehouse_code}</span>
          </KV>
        )}
        <KV label={t('auditLog.logId')}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            #{entry.log_id}
          </span>
        </KV>
      </div>

      {hasDetails && (
        <div>
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', marginBottom: 8,
          }}>
            <h4 style={{
              fontSize: 11, color: 'var(--text-secondary)',
              textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600,
            }}>
              {t('auditLog.eventDetails')}
            </h4>
            <button className="btn btn-sm" onClick={copyJson} title={t('auditLog.copyJsonTooltip')}>
              {t('auditLog.copyJson')}
            </button>
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'minmax(120px, 200px) 1fr',
            gap: '4px 14px', fontSize: 12,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 6, padding: 10,
          }}>
            {Object.entries(details).map(([k, v]) => (
              <DetailRow key={k} label={k} value={v} />
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function KV({ label, children }) {
  return (
    <>
      <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
      <span style={{
        display: 'inline-flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 4,
      }}>
        {children}
      </span>
    </>
  );
}

function DetailRow({ label, value }) {
  const isObj = value !== null && typeof value === 'object';
  return (
    <>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="mono" style={{
        wordBreak: 'break-word',
        whiteSpace: isObj ? 'pre-wrap' : 'normal',
      }}>
        {isObj ? JSON.stringify(value, null, 2) : formatValue(value)}
      </span>
    </>
  );
}
