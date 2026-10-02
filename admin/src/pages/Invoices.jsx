import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { useWarehouse } from '../warehouse.jsx';
import { useLocale } from '../i18n/locale.jsx';

function money(value, currency = 'VND') {
  return `${Number(value || 0).toLocaleString('vi-VN')} ${currency}`;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/** Period for MONTHLY / WEEKLY / PER_EVENT around today (local). */
export function periodForBillingCycle(billingCycle, asOf = new Date()) {
  const day = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  if (billingCycle === 'WEEKLY') {
    const mondayOffset = (day.getDay() + 6) % 7; // Mon=0
    const start = new Date(day);
    start.setDate(day.getDate() - mondayOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { period_start: isoDate(start), period_end: isoDate(end) };
  }
  if (billingCycle === 'MONTHLY') {
    const start = new Date(day.getFullYear(), day.getMonth(), 1);
    const end = new Date(day.getFullYear(), day.getMonth() + 1, 0);
    return { period_start: isoDate(start), period_end: isoDate(end) };
  }
  // PER_EVENT → today
  const today = isoDate(day);
  return { period_start: today, period_end: today };
}

export default function Invoices() {
  const { t } = useLocale();
  const { warehouseId } = useWarehouse();
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [form, setForm] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [invoiceRes, customerRes, contractRes] = await Promise.all([
      api.get('/admin/billing/invoices?per_page=1000'),
      api.get('/admin/customers?active=true'),
      api.get('/admin/customer-contracts'),
    ]);
    if (invoiceRes?.ok) setInvoices((await invoiceRes.json()).invoices || []);
    if (customerRes?.ok) setCustomers((await customerRes.json()).customers || []);
    if (contractRes?.ok) setContracts((await contractRes.json()).contracts || []);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const customerContracts = contracts.filter(
    (contract) => contract.customer_id === form?.customer_id,
  );

  function applyContractPeriod(contractId) {
    const contract = contracts.find((c) => String(c.contract_id) === String(contractId));
    if (!contract) {
      setForm((prev) => ({ ...prev, contract_id: contractId }));
      return;
    }
    const period = periodForBillingCycle(contract.billing_cycle || 'MONTHLY');
    setForm((prev) => ({
      ...prev,
      contract_id: contractId,
      period_start: period.period_start,
      period_end: period.period_end,
    }));
  }

  async function create() {
    if (!form?.customer_id || !form?.period_start || !form?.period_end) {
      setError(t('invoices.customerAndPeriodRequired'));
      return;
    }
    setBusy(true);
    setError('');
    const res = await api.post('/admin/billing/invoices', {
      customer_id: form.customer_id,
      contract_id: form.contract_id ? Number(form.contract_id) : null,
      period_start: form.period_start,
      period_end: form.period_end,
      include_unbilled_events: true,
      notes: form.notes || null,
    });
    setBusy(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setError(data?.error || 'Không tạo được hóa đơn');
      return;
    }
    setForm(null);
    setNotice('');
    await load();
  }

  async function generateByCycle() {
    setBusy(true);
    setError('');
    setNotice('');
    const body = {};
    if (warehouseId) body.warehouse_id = warehouseId;
    const res = await api.post('/admin/billing/invoices/generate-cycle', body);
    setBusy(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setError(data?.error || t('invoices.cycleRunFailed'));
      return;
    }
    const data = await res.json();
    setNotice(
      t('invoices.cycleRunResult', {
        created: data.created_count || 0,
        skipped: data.skipped_count || 0,
      }),
    );
    await load();
  }

  async function previewInvoice(invoice) {
    const res = await api.get(`/admin/billing/invoices/${invoice.invoice_id}`);
    if (!res?.ok) return;
    setPreview(await res.json());
  }

  async function setStatus(invoiceId, status) {
    const res = await api.put(`/admin/billing/invoices/${invoiceId}`, { status });
    if (res?.ok) {
      await load();
      if (preview) await previewInvoice({ invoice_id: invoiceId });
    }
  }

  function printPreview() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const html = document.getElementById('invoice-preview')?.innerHTML || '';
    printWindow.document.write(
      `<html><head><title>${preview.invoice.invoice_number}</title>`
      + '<style>body{font-family:Arial;padding:32px;color:#111}table{width:100%;border-collapse:collapse}'
      + 'th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}.right{text-align:right}</style>'
      + `</head><body>${html}</body></html>`,
    );
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  async function downloadPdf() {
    if (!preview?.invoice?.invoice_id) return;
    setBusy(true);
    setError('');
    const res = await api.get(`/admin/billing/invoices/${preview.invoice.invoice_id}/pdf`);
    setBusy(false);
    if (!res?.ok) {
      setError(t('invoices.pdfFailed'));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${preview.invoice.invoice_number || `invoice-${preview.invoice.invoice_id}`}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const columns = [
    { key: 'invoice_number', labelKey: 'invoices.number', render: (row) => row.invoice_number || `#${row.invoice_id}` },
    { key: 'customer_name', labelKey: 'common.customer' },
    { key: 'contract_number', labelKey: 'customers.contracts', render: (row) => row.contract_number || '—' },
    { key: 'period_start', labelKey: 'invoices.period', render: (row) => `${row.period_start} → ${row.period_end}` },
    { key: 'due_date', labelKey: 'invoices.dueDate' },
    { key: 'total_amount', labelKey: 'invoices.total', render: (row) => money(row.total_amount, row.currency) },
    {
      key: 'status',
      labelKey: 'common.status',
      render: (row) => (
        <span className={`status-tag status-${String(row.status).toLowerCase()}`}>{row.status}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <button type="button" className="btn btn-sm" onClick={() => previewInvoice(row)}>
          {t('invoices.viewPrint')}
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('nav.invoices')}>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={generateByCycle}
        >
          {t('invoices.runCycle')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setError('');
            setForm({ include_unbilled_events: true });
          }}
        >
          {t('invoices.newInvoice')}
        </button>
      </PageHeader>

      {notice && <div className="alert alert-info" style={{ marginBottom: 12 }}>{notice}</div>}
      {error && !form && !preview && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>
      )}

      <DataTable columns={columns} data={invoices} rowKey="invoice_id" />

      {form && (
        <Modal
          title={t('invoices.newInvoiceTitle')}
          onClose={() => setForm(null)}
          footer={(
            <>
              <button type="button" className="btn" onClick={() => setForm(null)}>{t('common.cancel')}</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={create}>
                {t('invoices.create')}
              </button>
            </>
          )}
        >
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-group">
            <label htmlFor="invoice-customer">{t('customers.customerRequired')}</label>
            <select
              id="invoice-customer"
              className="form-input"
              value={form.customer_id || ''}
              onChange={(e) => setForm({
                ...form,
                customer_id: e.target.value,
                contract_id: '',
              })}
            >
              <option value="">{t('customers.pickCustomer')}</option>
              {customers.map((customer) => (
                <option key={customer.customer_id} value={customer.customer_id}>
                  {customer.customer_code} · {customer.customer_name} · Chưa xuất{' '}
                  {money(customer.unbilled_amount, customer.default_currency)}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="invoice-contract">{t('customers.contracts')}</label>
            <select
              id="invoice-contract"
              className="form-input"
              value={form.contract_id || ''}
              onChange={(e) => applyContractPeriod(e.target.value)}
            >
              <option value="">{t('invoices.noContract')}</option>
              {customerContracts.map((contract) => (
                <option key={contract.contract_id} value={contract.contract_id}>
                  {contract.contract_number} · {contract.contract_name}
                  {' · '}{contract.billing_cycle}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="period-start">{t('invoices.fromDate')}</label>
              <input
                id="period-start"
                className="form-input"
                type="date"
                value={form.period_start || ''}
                onChange={(e) => setForm({ ...form, period_start: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="period-end">{t('invoices.toDate')}</label>
              <input
                id="period-end"
                className="form-input"
                type="date"
                value={form.period_end || ''}
                onChange={(e) => setForm({ ...form, period_end: e.target.value })}
              />
            </div>
          </div>
          <div className="alert alert-info">
            {t('invoices.contractPeriodHint')}
          </div>
          <div className="form-group">
            <label htmlFor="invoice-notes">{t('common.notes')}</label>
            <textarea
              id="invoice-notes"
              className="form-input"
              rows="3"
              value={form.notes || ''}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </Modal>
      )}

      {preview && (
        <Modal
          title={preview.invoice.invoice_number
            || t('invoices.invoiceNumbered', { id: preview.invoice.invoice_id })}
          onClose={() => setPreview(null)}
          footer={(
            <>
              <button type="button" className="btn" onClick={() => setPreview(null)}>{t('common.close')}</button>
              {preview.invoice.status === 'DRAFT' && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setStatus(preview.invoice.invoice_id, 'SENT')}
                >
                  {t('invoices.issue')}
                </button>
              )}
              {preview.invoice.status === 'SENT' && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setStatus(preview.invoice.invoice_id, 'PAID')}
                >
                  {t('invoices.markPaid')}
                </button>
              )}
              <button type="button" className="btn" onClick={printPreview}>In</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={downloadPdf}>
                {t('invoices.downloadPdf')}
              </button>
            </>
          )}
        >
          {error && <div className="alert alert-error">{error}</div>}
          <div id="invoice-preview" style={{ padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0 }}>SƠN LỘC WMS</h2>
                <strong>{preview.invoice.invoice_number}</strong>
              </div>
              <div>
                <div><strong>{preview.invoice.customer_name}</strong></div>
                <div>{preview.invoice.customer_code}</div>
                <div>{t('invoices.taxIdLine', { id: preview.invoice.tax_id || '—' })}</div>
                <div>{preview.invoice.billing_address || ''}</div>
              </div>
            </div>
            <div>
              {t('invoices.servicePeriod', {
                from: preview.invoice.period_start,
                to: preview.invoice.period_end,
              })}
            </div>
            <div>
              {t('invoices.dueAndStatus', {
                due: preview.invoice.due_date || '—',
                status: preview.invoice.status,
              })}
            </div>
            {preview.invoice.contract_number && (
              <div>
                {t('invoices.contractLine', { number: preview.invoice.contract_number })}
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
              <thead>
                <tr>
                  <th>{t('invoices.service')}</th>
                  <th>{t('salesOrders.quantity')}</th>
                  <th>{t('invoices.unitPrice')}</th>
                  <th style={{ textAlign: 'right' }}>{t('invoices.lineTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((line) => (
                  <tr key={line.line_id}>
                    <td>{line.description}</td>
                    <td>{line.quantity}</td>
                    <td>{money(line.unit_price, preview.invoice.currency)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {money(line.amount, preview.invoice.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ textAlign: 'right', fontSize: 18, fontWeight: 700, marginTop: 20 }}>
              {t('invoices.grandTotal', {
                total: money(preview.invoice.total_amount, preview.invoice.currency),
              })}
            </div>
            {preview.invoice.notes && (
              <div style={{ marginTop: 20 }}>
                {t('invoices.notesLine', { notes: preview.invoice.notes })}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
