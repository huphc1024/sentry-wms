import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import { useLocale } from '../i18n/locale.jsx';

// notification_webhooks admin surface. Operators
// configure per-warehouse Teams destinations that receive the
// backorder.* event family (opened / fulfillable / cancelled). The
// URL is Fernet-encrypted at rest and never returned in plaintext;
// the list shows a masked host preview. A "rotate URL" action lets
// operators swap the destination without round-tripping the
// secret back to the browser. "Test send" fires a sample
// backorder.opened adaptive card so the operator can verify the
// Teams channel renders before real events flow.
//
// The same surface also subscribes a channel to the webhook
// dispatcher's self-monitor (dispatcher.* alerts) -- a stuck
// delivery, dead-lettering, a subscription falling behind or
// auto-pausing. Those are NOT integration events; the dispatcher
// raises them and fans them out here so a delivery degradation pages
// the operator in minutes instead of going unnoticed.

const SUPPORTED_CHANNELS = [
  // A product name, not copy -- it reads the same in both languages.
  { value: 'teams', labelKey: 'notifications.channelTeams' },
];

// Grouped so the operator can tell business events apart from
// dispatcher ops alerts. Mirrors api/schemas/notification_webhooks.py
// ALLOWED_EVENT_TYPES; a value not in that backend allowlist is
// rejected at create/PATCH time.
const EVENT_TYPE_GROUPS = [
  {
    groupKey: 'notifications.groupBackorder',
    options: [
      { value: 'backorder.opened',      label: 'backorder.opened',      descKey: 'notifications.descShorted' },
      { value: 'backorder.fulfillable', label: 'backorder.fulfillable', descKey: 'notifications.descFulfillable' },
      { value: 'backorder.cancelled',   label: 'backorder.cancelled',   descKey: 'notifications.descCancelled' },
    ],
  },
  {
    groupKey: 'notifications.groupDispatcher',
    options: [
      { value: 'dispatcher.delivery_stalled',     label: 'dispatcher.delivery_stalled',     descKey: 'notifications.descStalled' },
      { value: 'dispatcher.dlq_growth',           label: 'dispatcher.dlq_growth',           descKey: 'notifications.descDlq' },
      { value: 'dispatcher.subscription_lagging', label: 'dispatcher.subscription_lagging', descKey: 'notifications.descLagging' },
      { value: 'dispatcher.subscription_paused',  label: 'dispatcher.subscription_paused',  descKey: 'notifications.descPaused' },
    ],
  },
];

const DEFAULT_EVENT_FILTER = ['backorder.opened', 'backorder.fulfillable'];


function EventFilterCheckboxes({ value, onChange, disabled = false }) {
  const { t } = useLocale();
  const set = new Set(value || []);
  const toggle = (optValue, checked) => {
    const next = new Set(set);
    if (checked) next.add(optValue); else next.delete(optValue);
    onChange([...next]);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {EVENT_TYPE_GROUPS.map((grp) => (
        <div key={grp.groupKey} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 }}>
            {t(grp.groupKey)}
          </div>
          {grp.options.map((opt) => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={set.has(opt.value)}
                disabled={disabled}
                onChange={(e) => toggle(opt.value, e.target.checked)}
              />
              <span className="mono">{opt.label}</span>
              {opt.descKey && <span style={{ opacity: 0.55 }}>-- {t(opt.descKey)}</span>}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}


function TestSendOutcome({ outcome }) {
  const { t } = useLocale();
  if (!outcome) return null;
  const ok = outcome.delivered;
  return (
    <div
      role="status"
      style={{
        marginTop: 8,
        padding: '6px 10px',
        background: ok ? 'var(--success-bg)' : 'var(--danger-bg)',
        color: ok ? 'var(--success)' : 'var(--danger)',
        border: `1px solid ${ok ? 'var(--success)' : 'var(--danger)'}`,
        borderRadius: 4,
        fontSize: 12,
        whiteSpace: 'pre-wrap',
      }}
    >
      {ok
        ? t('notifications.delivered', { status: outcome.status_code || 200 })
        : t('notifications.sendFailed', { kind: outcome.error_kind || t('tokens.noneLower') })
          + (outcome.status_code
            ? ` ${t('notifications.statusSuffix', { status: outcome.status_code })}`
            : '')
          + (outcome.error_detail ? `\n${outcome.error_detail}` : '')}
    </div>
  );
}


export default function Notifications() {
  const { t } = useLocale();
  const { warehouseId } = useWarehouse();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const [successBanner, setSuccessBanner] = useState('');

  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    channel_kind: 'teams',
    url: '',
    event_filter: DEFAULT_EVENT_FILTER,
    enabled: true,
    secret: '',
  });
  const [createError, setCreateError] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);

  const [rotating, setRotating] = useState(null);
  const [rotateUrl, setRotateUrl] = useState('');
  const [rotateError, setRotateError] = useState('');
  const [rotateSubmitting, setRotateSubmitting] = useState(false);

  // Per-row test-send outcomes keyed by webhook_id so multiple
  // tests in flight do not blow away each other's status.
  const [testOutcomes, setTestOutcomes] = useState({});
  const [testInFlight, setTestInFlight] = useState({});

  const [deleting, setDeleting] = useState(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setPageError('');
    const qs = new URLSearchParams();
    if (warehouseId) qs.set('warehouse_id', String(warehouseId));
    const res = await api.get(`/admin/notification-webhooks?${qs.toString()}`);
    if (res?.ok) {
      const data = await res.json();
      setRows(data.notification_webhooks || []);
    } else {
      setRows([]);
      setPageError('Failed to load notification webhooks.');
    }
    setLoading(false);
  }, [warehouseId]);

  useEffect(() => { load(); }, [load]);

  function flashSuccess(msg) {
    setSuccessBanner(msg);
    setTimeout(() => setSuccessBanner(''), 6000);
  }

  function openCreate() {
    setCreateForm({
      channel_kind: 'teams',
      url: '',
      event_filter: DEFAULT_EVENT_FILTER,
      enabled: true,
      secret: '',
    });
    setCreateError('');
    setCreating(true);
  }

  function closeCreate() {
    setCreating(false);
    setCreateError('');
    setCreateSubmitting(false);
  }

  async function submitCreate() {
    if (!warehouseId) {
      setCreateError('Pick a warehouse from the top bar first.');
      return;
    }
    if (!createForm.url) {
      setCreateError('URL is required.');
      return;
    }
    if (!createForm.event_filter || createForm.event_filter.length === 0) {
      setCreateError('Select at least one event type.');
      return;
    }
    setCreateSubmitting(true);
    setCreateError('');
    const body = {
      warehouse_id: warehouseId,
      channel_kind: createForm.channel_kind,
      url: createForm.url,
      event_filter: createForm.event_filter,
      enabled: createForm.enabled,
    };
    if (createForm.secret) body.secret = createForm.secret;
    const res = await api.post('/admin/notification-webhooks', body);
    setCreateSubmitting(false);
    if (!res?.ok) {
      let data = null;
      try { data = await res?.json(); } catch (_) { /* non-JSON */ }
      setCreateError(data?.error || 'Failed to create webhook.');
      return;
    }
    closeCreate();
    flashSuccess('Notification webhook created.');
    load();
  }

  async function togglEnabled(row) {
    const res = await api.patch(
      `/admin/notification-webhooks/${row.webhook_id}`,
      { enabled: !row.enabled },
    );
    if (!res?.ok) {
      let data = null;
      try { data = await res?.json(); } catch (_) { /* non-JSON */ }
      setPageError(data?.error || 'Failed to toggle webhook.');
      return;
    }
    load();
  }

  function openRotate(row) {
    setRotating(row);
    setRotateUrl('');
    setRotateError('');
  }

  function closeRotate() {
    setRotating(null);
    setRotateUrl('');
    setRotateError('');
    setRotateSubmitting(false);
  }

  async function submitRotate() {
    if (!rotateUrl) {
      setRotateError('New URL is required.');
      return;
    }
    setRotateSubmitting(true);
    setRotateError('');
    const res = await api.post(
      `/admin/notification-webhooks/${rotating.webhook_id}/rotate-url`,
      { url: rotateUrl },
    );
    setRotateSubmitting(false);
    if (!res?.ok) {
      let data = null;
      try { data = await res?.json(); } catch (_) { /* non-JSON */ }
      setRotateError(data?.error || 'Failed to rotate URL.');
      return;
    }
    closeRotate();
    flashSuccess('Webhook URL rotated.');
    load();
  }

  async function testSend(row) {
    setTestInFlight((prev) => ({ ...prev, [row.webhook_id]: true }));
    setTestOutcomes((prev) => ({ ...prev, [row.webhook_id]: null }));
    const res = await api.post(
      `/admin/notification-webhooks/${row.webhook_id}/test-send`,
      {},
    );
    let outcome = null;
    try { outcome = await res?.json(); } catch (_) { /* non-JSON */ }
    setTestInFlight((prev) => ({ ...prev, [row.webhook_id]: false }));
    if (!res?.ok) {
      setTestOutcomes((prev) => ({
        ...prev,
        [row.webhook_id]: {
          delivered: false,
          error_kind: 'request_failed',
          error_detail: outcome?.error || 'request failed',
        },
      }));
      return;
    }
    setTestOutcomes((prev) => ({ ...prev, [row.webhook_id]: outcome }));
  }

  function openDelete(row) {
    setDeleting(row);
  }

  function closeDelete() {
    setDeleting(null);
    setDeleteSubmitting(false);
  }

  async function submitDelete() {
    setDeleteSubmitting(true);
    const res = await api.delete(
      `/admin/notification-webhooks/${deleting.webhook_id}`,
    );
    setDeleteSubmitting(false);
    if (!res?.ok) {
      setPageError('Failed to delete webhook.');
      closeDelete();
      return;
    }
    closeDelete();
    flashSuccess('Webhook deleted.');
    load();
  }

  const columns = [
    { key: 'webhook_id', labelKey: 'notifications.id', mono: true },
    { key: 'channel_kind', labelKey: 'posActivity.channel' },
    { key: 'host_preview', labelKey: 'notifications.host',
      render: (r) => r.host_preview
        ? <span className="mono" style={{ fontSize: 12 }}>{r.host_preview}</span>
        : <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{t('notifications.decryptFailed')}</span>,
    },
    { key: 'event_filter', labelKey: 'notifications.events',
      render: (r) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {(r.event_filter || []).map((e) => (
            <span key={e} className="mono" style={{ fontSize: 11 }}>{e}</span>
          ))}
        </div>
      ),
    },
    { key: 'enabled', labelKey: 'notifications.enabled',
      render: (r) => (
        <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => { e.stopPropagation(); togglEnabled(r); }}
          />
          <span style={{ fontSize: 12 }}>{t(r.enabled ? 'notifications.on' : 'notifications.off')}</span>
        </label>
      ),
    },
    { key: 'created_at', labelKey: 'salesOrders.created',
      render: (r) => r.created_at ? new Date(r.created_at).toLocaleString() : '-',
    },
    { key: 'actions', labelKey: 'common.actions',
      render: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              className="btn btn-sm"
              onClick={() => testSend(r)}
              disabled={!!testInFlight[r.webhook_id]}
              title="Send a sample backorder.opened card to verify the channel"
            >
              {t(testInFlight[r.webhook_id] ? 'notifications.sending' : 'notifications.test')}
            </button>
            <button className="btn btn-sm" onClick={() => openRotate(r)}>
              {t('notifications.rotateUrl')}
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => openDelete(r)}>
              {t('common.delete')}
            </button>
          </div>
          <TestSendOutcome outcome={testOutcomes[r.webhook_id]} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('nav.notifications')}>
        <button
          className="btn btn-primary"
          onClick={openCreate}
          disabled={!warehouseId}
        >
          {t('notifications.newWebhook')}
        </button>
      </PageHeader>
      {!warehouseId && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {t('notifications.pickWarehouse')}
        </p>
      )}
      {successBanner && (
        <div
          role="status"
          style={{
            margin: '0 0 12px 0',
            padding: '8px 12px',
            background: 'var(--success-bg)',
            color: 'var(--success)',
            border: '1px solid var(--success)',
            borderRadius: 4,
            fontSize: 13,
          }}
        >
          {successBanner}
        </div>
      )}
      {pageError && (
        <div className="form-error" style={{ marginBottom: 12 }}>{pageError}</div>
      )}
      <div className="section">
        <DataTable
          rowKey="webhook_id"
          columns={columns}
          data={rows}
          loading={loading}
          emptyMessageKey="notifications.empty"
        />
      </div>

      {creating && (
        <Modal
          title={t('notifications.newWebhookTitle')}
          onClose={closeCreate}
          footer={
            <>
              <button className="btn" onClick={closeCreate} disabled={createSubmitting}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                onClick={submitCreate}
                disabled={createSubmitting}
              >
                {t(createSubmitting ? 'salesOrders.creating' : 'common.create')}
              </button>
            </>
          }
        >
          {createError && (
            <div className="form-error" style={{ marginBottom: 12 }}>{createError}</div>
          )}
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
            URL is encrypted at rest and never returned by the API. The
            value you enter here is the only chance to capture it
            visually -- record it elsewhere if you need a backup.
            "Rotate URL" later replaces the ciphertext but does not
            expose the old value.
          </p>
          <div className="form-row">
            <div className="form-group">
              <label>{t('posActivity.channel')}</label>
              <select
                className="form-select"
                value={createForm.channel_kind}
                onChange={(e) => setCreateForm({ ...createForm, channel_kind: e.target.value })}
              >
                {SUPPORTED_CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>{t(c.labelKey)}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t('notifications.enabled')}</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8 }}>
                <input
                  type="checkbox"
                  checked={createForm.enabled}
                  onChange={(e) => setCreateForm({ ...createForm, enabled: e.target.checked })}
                />
                <span style={{ fontSize: 13 }}>{t('notifications.receiveNow')}</span>
              </label>
            </div>
          </div>
          <div className="form-group">
            <label>{t('webhooks.url')}</label>
            <input
              className="form-input"
              type="url"
              placeholder="https://outlook.office.com/webhook/..."
              value={createForm.url}
              onChange={(e) => setCreateForm({ ...createForm, url: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>{t('notifications.events')}</label>
            <EventFilterCheckboxes
              value={createForm.event_filter}
              onChange={(v) => setCreateForm({ ...createForm, event_filter: v })}
            />
          </div>
          <div className="form-group">
            <label>{t('notifications.hmacSecret')}</label>
            <input
              className="form-input"
              type="text"
              placeholder={t('notifications.hmacHint')}
              value={createForm.secret}
              onChange={(e) => setCreateForm({ ...createForm, secret: e.target.value })}
            />
          </div>
        </Modal>
      )}

      {rotating && (
        <Modal
          title={t('notifications.rotateTitle', { id: rotating.webhook_id })}
          onClose={closeRotate}
          footer={
            <>
              <button className="btn" onClick={closeRotate} disabled={rotateSubmitting}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                onClick={submitRotate}
                disabled={rotateSubmitting}
              >
                {t(rotateSubmitting ? 'notifications.rotating' : 'webhooks.rotate')}
              </button>
            </>
          }
        >
          {rotateError && (
            <div className="form-error" style={{ marginBottom: 12 }}>{rotateError}</div>
          )}
          <p style={{ fontSize: 13, marginBottom: 12 }}>
            {t('notifications.rotateExplain')}
          </p>
          <div className="form-group">
            <label>{t('notifications.newUrl')}</label>
            <input
              className="form-input"
              type="url"
              value={rotateUrl}
              onChange={(e) => setRotateUrl(e.target.value)}
              placeholder="https://outlook.office.com/webhook/..."
            />
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal
          title={t('notifications.deleteTitle', { id: deleting.webhook_id })}
          onClose={closeDelete}
          footer={
            <>
              <button className="btn" onClick={closeDelete} disabled={deleteSubmitting}>{t('common.cancel')}</button>
              <button
                className="btn btn-danger"
                onClick={submitDelete}
                disabled={deleteSubmitting}
              >
                {t(deleteSubmitting ? 'notifications.deleting' : 'common.delete')}
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13 }}>
            Backorder events for this warehouse will no longer reach this
            destination. The integration_events outbox is unaffected; a
            future polling worker could still replay if you re-create
            the row.
          </p>
        </Modal>
      )}
    </div>
  );
}
