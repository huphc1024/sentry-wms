import { useState } from 'react';
import DataTable from '../components/DataTable.jsx';
import Pagination from '../components/Pagination.jsx';
import StatusTag from '../components/StatusTag.jsx';
import usePagedList from '../hooks/usePagedList.js';
import { useLocale } from '../i18n/locale.jsx';
import { formatDate, formatDateTime, formatNumber } from '../utils/format.js';

const STATUS_FILTERS = [
  { value: '', key: 'inbound.filter.all' },
  { value: 'OPEN', key: 'inbound.filter.OPEN' },
  { value: 'PARTIAL', key: 'inbound.filter.PARTIAL' },
  { value: 'RECEIVED', key: 'inbound.filter.RECEIVED' },
  { value: 'CLOSED', key: 'inbound.filter.CLOSED' },
];

function Progress({ ordered, received }) {
  const pct = ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : 0;
  return (
    <div className="progress" title={`${received}/${ordered}`}>
      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <span className="mono">{pct}%</span>
    </div>
  );
}

export default function Inbound() {
  const { t } = useLocale();
  const [status, setStatus] = useState('');
  const list = usePagedList('/inbound', 'purchase_orders', { status });

  const columns = [
    { key: 'po_number', label: t('inbound.col.poNumber'), mono: true },
    { key: 'status', label: t('inbound.col.status'), render: (r) => <StatusTag status={r.status} /> },
    { key: 'expected_date', label: t('inbound.col.expected'), render: (r) => formatDate(r.expected_date) },
    { key: 'received_at', label: t('inbound.col.receivedAt'), render: (r) => formatDateTime(r.received_at) },
    { key: 'warehouse_code', label: t('inbound.col.warehouse'), mono: true },
    { key: 'line_count', label: t('inbound.col.lines'), align: 'right', render: (r) => formatNumber(r.line_count) },
    {
      key: 'quantity',
      label: t('inbound.col.quantity'),
      align: 'right',
      render: (r) => (
        <span className="mono">
          {formatNumber(r.quantity_ordered)} / {formatNumber(r.quantity_received)}
        </span>
      ),
    },
    {
      key: 'progress',
      label: t('inbound.col.progress'),
      render: (r) => <Progress ordered={r.quantity_ordered} received={r.quantity_received} />,
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('inbound.title')}</h1>
        <select
          className="form-input filter-input"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t('inbound.filterAria')}
        >
          {STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{t(f.key)}</option>)}
        </select>
      </div>
      <p className="page-note">
        {t('inbound.note')}
      </p>
      {list.error && <div className="alert alert-danger" role="alert">{list.error}</div>}
      <div className="card">
        <DataTable
          columns={columns}
          rows={list.rows}
          rowKey={(r) => r.po_number}
          loading={list.loading}
          empty={t('inbound.empty')}
        />
        <Pagination
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onChange={list.setPage}
        />
      </div>
    </div>
  );
}
