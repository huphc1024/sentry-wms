import { useState, useEffect } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import { useLocale } from '../i18n/locale.jsx';

// v1.7.0 plan §4.2: read-only Inbound observability page. Lists the
// last N rows across all five inbound_<resource> staging tables with
// filters for source_system / resource / status. Detail view shows
// source_payload + canonical_payload + ingest metadata. v1.7 ships
// no replay / edit / manual-fix UI -- per plan §4.3 the canonical
// fix path is operator SQL with audit_log; admin UI for inbound data
// fixes lands once NetSuite (v2.0) reveals what fix workflows are
// actually needed.

const RESOURCE_OPTIONS = [
  { value: '', labelKey: 'inboundActivity.allResources' },
  { value: 'sales_orders' },
  { value: 'items' },
  { value: 'customers' },
  { value: 'vendors' },
  { value: 'purchase_orders' },
];

const STATUS_OPTIONS = [
  { value: '', labelKey: 'dashboard.allStatuses' },
  { value: 'applied' },
  { value: 'superseded' },
];

function fmtTimestamp(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function InboundActivity() {
  const { t } = useLocale();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    source_system: '',
    resource: '',
    status: '',
  });
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (filters.source_system) params.set('source_system', filters.source_system);
    if (filters.resource) params.set('resource', filters.resource);
    if (filters.status) params.set('status', filters.status);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await api.get(`/admin/inbound/activity${qs}`);
    if (res?.ok) {
      const data = await res.json();
      setRows(data.rows || []);
    } else {
      const body = await res?.json();
      setError(body?.error || 'Failed to load inbound activity');
    }
    setLoading(false);
  }

  async function openDetail(row) {
    setDetailLoading(true);
    setDetail({ summary: row });
    const res = await api.get(
      `/admin/inbound/activity/${row.resource}/${row.inbound_id}`,
    );
    if (res?.ok) {
      const data = await res.json();
      setDetail({ summary: row, full: data });
    } else {
      const body = await res?.json();
      setDetail({ summary: row, error: body?.error || t('inboundActivity.detailFailed') });
    }
    setDetailLoading(false);
  }

  const columns = [
    {
      key: 'received_at',
      labelKey: 'inboundActivity.received',
      render: (r) => (
        <span className="mono" style={{ fontSize: 12 }}>
          {fmtTimestamp(r.received_at)}
        </span>
      ),
    },
    {
      key: 'resource',
      labelKey: 'inboundActivity.resource',
      render: (r) => <span className="mono" style={{ fontSize: 12 }}>{r.resource}</span>,
    },
    {
      key: 'source_system',
      labelKey: 'salesOrders.sourceSystem',
      render: (r) => <span className="mono" style={{ fontSize: 12 }}>{r.source_system}</span>,
    },
    {
      key: 'external_id',
      labelKey: 'inboundActivity.externalId',
      render: (r) => <span className="mono" style={{ fontSize: 12 }}>{r.external_id}</span>,
    },
    {
      key: 'external_version',
      labelKey: 'settings.version',
      render: (r) => (
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {r.external_version}
        </span>
      ),
    },
    {
      key: 'status',
      labelKey: 'common.status',
      render: (r) => (
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: r.status === 'applied' ? 'var(--text-secondary)' : 'var(--danger)',
        }}>
          {r.status}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (r) => (
        <button
          className="btn btn-sm"
          onClick={(e) => { e.stopPropagation(); openDetail(r); }}
        >
          {t('inboundActivity.view')}
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('nav.inboundActivity')}>
        <button className="btn" onClick={load} disabled={loading}>
          {t(loading ? 'common.loading' : 'common.refresh')}
        </button>
      </PageHeader>

      {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}

      {/* Filter row -- inline so the common case (one source_system,
          one resource) stays a single click + select. */}
      <div style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-end',
        marginBottom: 16,
        padding: 12,
        background: 'var(--surface-muted)',
        borderRadius: 4,
      }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            {t('salesOrders.sourceSystem')}
          </label>
          <input
            className="form-input"
            value={filters.source_system}
            onChange={(e) => setFilters({ ...filters, source_system: e.target.value })}
            placeholder="exact match (e.g. fabric)"
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            {t('inboundActivity.resource')}
          </label>
          <select
            className="form-input"
            value={filters.resource}
            onChange={(e) => setFilters({ ...filters, resource: e.target.value })}
          >
            {RESOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.labelKey ? t(o.labelKey) : o.value}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            {t('common.status')}
          </label>
          <select
            className="form-input"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.labelKey ? t(o.labelKey) : o.value}</option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" onClick={load}>{t('inboundActivity.apply')}</button>
      </div>

      <DataTable
        rowKey="inbound_id"
        columns={columns}
        data={rows}
        emptyMessageKey={loading ? 'common.loading' : 'inboundActivity.empty'}
      />

      {detail && (
        <Modal
          title={t('inboundActivity.rowTitle', {
            resource: detail.summary.resource,
            id: detail.summary.inbound_id,
          })}
          onClose={() => setDetail(null)}
          footer={<button className="btn" onClick={() => setDetail(null)}>{t('common.close')}</button>}
        >
          {detailLoading && <div>{t('common.loading')}</div>}
          {detail.error && <div className="form-error">{detail.error}</div>}
          {detail.full && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 6, marginBottom: 12, fontSize: 13 }}>
                <div style={{ color: 'var(--text-secondary)' }}>{t('inboundActivity.receivedAt')}</div>
                <div className="mono">{fmtTimestamp(detail.full.received_at)}</div>
                <div style={{ color: 'var(--text-secondary)' }}>{t('common.status')}</div>
                <div className="mono">{detail.full.status}</div>
                <div style={{ color: 'var(--text-secondary)' }}>{t('inboundActivity.supersededAt')}</div>
                <div className="mono">{fmtTimestamp(detail.full.superseded_at)}</div>
                <div style={{ color: 'var(--text-secondary)' }}>{t('salesOrders.sourceSystem')}</div>
                <div className="mono">{detail.full.source_system}</div>
                <div style={{ color: 'var(--text-secondary)' }}>{t('inboundActivity.externalId')}</div>
                <div className="mono">{detail.full.external_id}</div>
                <div style={{ color: 'var(--text-secondary)' }}>{t('inboundActivity.externalVersion')}</div>
                <div className="mono">{detail.full.external_version}</div>
                <div style={{ color: 'var(--text-secondary)' }}>{t('inboundActivity.canonicalId')}</div>
                <div className="mono" style={{ wordBreak: 'break-all' }}>{detail.full.canonical_id}</div>
                <div style={{ color: 'var(--text-secondary)' }}>{t('inboundActivity.tokenId')}</div>
                <div className="mono">{detail.full.ingested_via_token_id}</div>
              </div>
              <PayloadBlock title={t('inboundActivity.sourcePayload')} value={detail.full.source_payload} />
              <PayloadBlock title={t('inboundActivity.canonicalPayload')} value={detail.full.canonical_payload} />
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function PayloadBlock({ title, value }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <pre style={{
        background: 'var(--surface-muted)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: 10,
        fontSize: 12,
        maxHeight: 320,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
