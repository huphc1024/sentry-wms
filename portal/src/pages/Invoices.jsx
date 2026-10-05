import { useNavigate } from 'react-router-dom';
import DataTable from '../components/DataTable.jsx';
import Pagination from '../components/Pagination.jsx';
import StatusTag from '../components/StatusTag.jsx';
import { useLocale } from '../i18n/locale.jsx';
import usePagedList from '../hooks/usePagedList.js';
import { formatDate, formatMoney } from '../utils/format.js';

export default function Invoices() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const list = usePagedList('/invoices', 'invoices');

  const columns = [
    { key: 'invoice_number', label: t('invoices.list.col.number'), mono: true },
    {
      key: 'period',
      label: t('invoices.list.col.period'),
      render: (r) => `${formatDate(r.period_start)} – ${formatDate(r.period_end)}`,
    },
    { key: 'issued_at', label: t('invoices.list.col.issued'), render: (r) => formatDate(r.issued_at) },
    { key: 'due_date', label: t('invoices.list.col.due'), render: (r) => formatDate(r.due_date) },
    {
      key: 'total_amount',
      label: t('invoices.list.col.total'),
      align: 'right',
      render: (r) => <strong className="mono">{formatMoney(r.total_amount, r.currency)}</strong>,
    },
    { key: 'status', label: t('invoices.list.col.status'), render: (r) => <StatusTag status={r.status} /> },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('invoices.list.title')}</h1>
      </div>
      <p className="page-note">{t('invoices.list.note')}</p>
      {list.error && <div className="alert alert-danger" role="alert">{list.error}</div>}
      <div className="card">
        <DataTable
          columns={columns}
          rows={list.rows}
          rowKey={(r) => r.invoice_number}
          loading={list.loading}
          empty={t('invoices.list.empty')}
          onRowClick={(r) => navigate(`/invoices/${encodeURIComponent(r.invoice_number)}`)}
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
