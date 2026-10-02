import { Link, useNavigate } from 'react-router-dom';
import DataTable from '../components/DataTable.jsx';
import Pagination from '../components/Pagination.jsx';
import StatusTag from '../components/StatusTag.jsx';
import { useLocale } from '../i18n/locale.jsx';
import usePagedList from '../hooks/usePagedList.js';
import { formatDate, formatNumber } from '../utils/format.js';

export default function Orders() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const list = usePagedList('/orders', 'orders');

  const columns = [
    { key: 'so_number', label: t('orders.list.soNumber'), mono: true },
    { key: 'status', label: t('orders.list.status'), render: (r) => <StatusTag status={r.status} /> },
    { key: 'order_date', label: t('orders.list.orderDate'), render: (r) => formatDate(r.order_date) },
    { key: 'ship_by_date', label: t('orders.list.shipBy'), render: (r) => formatDate(r.ship_by_date) },
    { key: 'warehouse_code', label: t('orders.list.warehouse'), mono: true },
    { key: 'line_count', label: t('orders.list.lineCount'), align: 'right', render: (r) => formatNumber(r.line_count) },
    {
      key: 'quantity',
      label: t('orders.list.orderedShipped'),
      align: 'right',
      render: (r) => (
        <span className="mono">
          {formatNumber(r.quantity_ordered)} / {formatNumber(r.quantity_shipped)}
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('orders.list.title')}</h1>
        <Link className="btn btn-primary" to="/orders/new">{t('orders.list.create')}</Link>
      </div>
      {list.error && <div className="alert alert-danger" role="alert">{list.error}</div>}
      <div className="card">
        <DataTable
          columns={columns}
          rows={list.rows}
          rowKey={(r) => r.so_number}
          loading={list.loading}
          empty={t('orders.list.empty')}
          onRowClick={(r) => navigate(`/orders/${encodeURIComponent(r.so_number)}`)}
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
