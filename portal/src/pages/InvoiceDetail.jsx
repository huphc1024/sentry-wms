import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import StatusTag from '../components/StatusTag.jsx';
import { useLocale } from '../i18n/locale.jsx';
import { friendlyErrorFromResponse } from '../utils/friendlyError.js';
import { formatDate, formatMoney, formatNumber } from '../utils/format.js';

export default function InvoiceDetail() {
  const { t } = useLocale();
  const { invoiceNumber } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await api.get(`/invoices/${encodeURIComponent(invoiceNumber)}`);
      if (cancelled || !res) return;
      if (!res.ok) {
        setError(await friendlyErrorFromResponse(res, t('invoices.detail.notFound')));
        setLoading(false);
        return;
      }
      setInvoice(await res.json());
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [invoiceNumber]);

  const columns = [
    { key: 'description', label: t('invoices.detail.col.description') },
    { key: 'quantity', label: t('invoices.detail.col.quantity'), align: 'right', render: (r) => formatNumber(r.quantity) },
    {
      key: 'unit_price',
      label: t('invoices.detail.col.unitPrice'),
      align: 'right',
      render: (r) => formatMoney(r.unit_price, invoice?.currency),
    },
    {
      key: 'amount',
      label: t('invoices.detail.col.amount'),
      align: 'right',
      render: (r) => <strong className="mono">{formatMoney(r.amount, invoice?.currency)}</strong>,
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="mono">{invoiceNumber}</h1>
        <Link className="btn btn-sm" to="/invoices">{t('invoices.detail.back')}</Link>
      </div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {loading && <div className="card-note">{t('invoices.detail.loading')}</div>}
      {invoice && (
        <>
          <div className="card detail-grid">
            <div><span>{t('invoices.detail.status')}</span><StatusTag status={invoice.status} /></div>
            <div>
              <span>{t('invoices.detail.period')}</span>
              <strong>{formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}</strong>
            </div>
            <div><span>{t('invoices.detail.issued')}</span><strong>{formatDate(invoice.issued_at)}</strong></div>
            <div><span>{t('invoices.detail.due')}</span><strong>{formatDate(invoice.due_date)}</strong></div>
            <div>
              <span>{t('invoices.detail.total')}</span>
              <strong className="mono">{formatMoney(invoice.total_amount, invoice.currency)}</strong>
            </div>
            {invoice.notes && (
              <div className="detail-wide"><span>{t('invoices.detail.notes')}</span><strong>{invoice.notes}</strong></div>
            )}
          </div>
          <div className="card">
            <h2 className="card-title">{t('invoices.detail.linesTitle')}</h2>
            <DataTable
              columns={columns}
              rows={invoice.lines}
              rowKey={(r, i) => `${r.description}-${i}`}
              empty={t('invoices.detail.noLines')}
            />
          </div>
        </>
      )}
    </div>
  );
}
