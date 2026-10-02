import { useEffect, useState } from 'react';
import DataTable from '../components/DataTable.jsx';
import Pagination from '../components/Pagination.jsx';
import usePagedList from '../hooks/usePagedList.js';
import { useLocale } from '../i18n/locale.jsx';
import RichText from '../i18n/RichText.jsx';
import { formatDate, formatNumber, daysUntil } from '../utils/format.js';

const EXPIRY_WARNING_DAYS = 30;

function ExpiryCell({ date }) {
  const { t } = useLocale();
  if (!date) return <span className="text-muted">—</span>;
  const days = daysUntil(date);
  let tone = '';
  if (days !== null && days < 0) tone = ' tag tag-danger';
  else if (days !== null && days <= EXPIRY_WARNING_DAYS) tone = ' tag tag-warning';
  return (
    <span className={`mono${tone}`}>
      {formatDate(date)}
      {days !== null && days < 0 && ` ${t('inventory.expired')}`}
      {days !== null && days >= 0 && days <= EXPIRY_WARNING_DAYS && ` ${t('inventory.daysLeft', { days })}`}
    </span>
  );
}

export default function Inventory() {
  const { t } = useLocale();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  // Debounced so typing a SKU does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setApplied(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const list = usePagedList('/inventory', 'items', { search: applied });

  const columns = [
    { key: 'sku', label: t('inventory.col.sku'), mono: true },
    { key: 'item_name', label: t('inventory.col.name') },
    { key: 'lot_number', label: t('inventory.col.lot'), mono: true, render: (r) => r.lot_number || '—' },
    { key: 'expiry_date', label: t('inventory.col.expiry'), render: (r) => <ExpiryCell date={r.expiry_date} /> },
    { key: 'warehouse_code', label: t('inventory.col.warehouse'), mono: true },
    { key: 'quantity_on_hand', label: t('inventory.col.onHand'), align: 'right', render: (r) => formatNumber(r.quantity_on_hand) },
    { key: 'quantity_allocated', label: t('inventory.col.allocated'), align: 'right', render: (r) => formatNumber(r.quantity_allocated) },
    { key: 'quantity_available', label: t('inventory.available'), align: 'right', render: (r) => <strong>{formatNumber(r.quantity_available)}</strong> },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('inventory.title')}</h1>
        <input
          className="form-input search-input"
          type="search"
          placeholder={t('inventory.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t('inventory.searchAria')}
        />
      </div>
      <p className="page-note">
        <RichText text={t('inventory.note')} values={{ available: <strong>{t('inventory.available')}</strong> }} />
      </p>
      {list.error && <div className="alert alert-danger" role="alert">{list.error}</div>}
      <div className="card">
        <DataTable
          columns={columns}
          rows={list.rows}
          rowKey={(r) => `${r.sku}|${r.lot_number || ''}|${r.expiry_date || ''}|${r.warehouse_code}`}
          loading={list.loading}
          empty={applied ? t('inventory.emptySearch') : t('inventory.empty')}
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
