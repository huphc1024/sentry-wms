import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { useLocale } from '../i18n/locale.jsx';

const EMPTY_CUSTOMER = { payment_terms_days: 30, default_currency: 'VND', is_active: true };
const EMPTY_CONTRACT = { status: 'DRAFT', billing_cycle: 'MONTHLY', payment_terms_days: 30, currency: 'VND' };

async function responseError(res, fallback) {
  const data = await res?.json().catch(() => ({}));
  return data?.error || fallback;
}

export default function Customers() {
  const { t } = useLocale();
  const [tab, setTab] = useState('customers');
  const [customers, setCustomers] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [customerForm, setCustomerForm] = useState(null);
  const [contractForm, setContractForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [printingContractId, setPrintingContractId] = useState(null);

  const load = useCallback(async () => {
    const [customerRes, contractRes, warehouseRes] = await Promise.all([
      api.get('/admin/customers'),
      api.get('/admin/customer-contracts'),
      api.get('/admin/warehouses?per_page=1000'),
    ]);
    if (customerRes?.ok) setCustomers((await customerRes.json()).customers || []);
    if (contractRes?.ok) setContracts((await contractRes.json()).contracts || []);
    if (warehouseRes?.ok) {
      const data = await warehouseRes.json();
      setWarehouses(data.warehouses || data || []);
    }
  }, []);

  // Initial remote-data hydration is intentionally effect-driven.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const activeCustomers = useMemo(
    () => customers.filter((customer) => customer.is_active),
    [customers],
  );

  async function saveCustomer() {
    if (!customerForm?.customer_name?.trim()) {
      setError(t('customers.nameRequired'));
      return;
    }
    setSaving(true); setError('');
    const body = {
      ...customerForm,
      payment_terms_days: Number(customerForm.payment_terms_days || 0),
    };
    const res = customerForm.customer_id
      ? await api.put(`/admin/customers/${customerForm.customer_id}`, body)
      : await api.post('/admin/customers', body);
    setSaving(false);
    if (!res?.ok) { setError(await responseError(res, t('customers.saveFailed'))); return; }
    setCustomerForm(null); await load();
  }

  async function saveContract() {
    if (!contractForm?.customer_id || !contractForm?.contract_name || !contractForm?.start_date) {
      setError(t('customers.contractFieldsRequired'));
      return;
    }
    setSaving(true); setError('');
    const body = {
      ...contractForm,
      warehouse_id: contractForm.warehouse_id ? Number(contractForm.warehouse_id) : null,
      payment_terms_days: Number(contractForm.payment_terms_days || 0),
    };
    const res = contractForm.contract_id
      ? await api.put(`/admin/customer-contracts/${contractForm.contract_id}`, body)
      : await api.post('/admin/customer-contracts', body);
    setSaving(false);
    if (!res?.ok) { setError(await responseError(res, t('customers.contractSaveFailed'))); return; }
    setContractForm(null); await load();
  }

  async function printContract(contract) {
    setPrintingContractId(contract.contract_id);
    setError('');
    const res = await api.get(`/admin/customer-contracts/${contract.contract_id}/pdf`);
    setPrintingContractId(null);
    if (!res?.ok) {
      setError(await responseError(res, 'Không tạo được file PDF hợp đồng'));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hop-dong-${contract.contract_number || contract.contract_id}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const customerColumns = [
    { key: 'customer_code', labelKey: 'customers.code' },
    { key: 'customer_name', labelKey: 'common.customer' },
    { key: 'contact_person', labelKey: 'customers.contact' },
    { key: 'phone', labelKey: 'common.phone' },
    { key: 'tax_id', labelKey: 'customers.taxId' },
    { key: 'contract_count', labelKey: 'customers.contracts' },
    { key: 'unbilled_amount', labelKey: 'customers.unbilled', render: (row) => Number(row.unbilled_amount || 0).toLocaleString('vi-VN') },
    {
      key: 'is_active',
      labelKey: 'common.status',
      render: (row) => (
        <span className={`status-tag ${row.is_active ? 'status-active' : 'status-cancelled'}`}>
          {t(row.is_active ? 'customers.statusActive' : 'customers.statusInactive')}
        </span>
      ),
    },
    { key: 'actions', label: '', render: (row) => <button type="button" className="btn btn-sm" onClick={() => { setError(''); setCustomerForm({ ...row }); }}>{t('common.edit')}</button> },
  ];

  const contractColumns = [
    { key: 'contract_number', labelKey: 'customers.contractNumber' },
    { key: 'contract_name', labelKey: 'customers.contractName' },
    { key: 'customer_name', labelKey: 'common.customer' },
    {
      key: 'warehouse_name',
      labelKey: 'customers.warehouseScope',
      render: (row) => row.warehouse_name || t('customers.allWarehouses'),
    },
    { key: 'start_date', labelKey: 'customers.startDate' },
    {
      key: 'end_date',
      labelKey: 'customers.endDate',
      render: (row) => row.end_date || t('customers.noEndDate'),
    },
    { key: 'rate_count', labelKey: 'customers.rateCount' },
    { key: 'status', labelKey: 'common.status', render: (row) => <span className={`status-tag status-${String(row.status).toLowerCase()}`}>{row.status}</span> },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-sm" onClick={() => { setError(''); setContractForm({ ...row }); }}>{t('common.edit')}</button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={printingContractId === row.contract_id}
            onClick={() => printContract(row)}
          >
            {t(printingContractId === row.contract_id
              ? 'customers.generatingPdf'
              : 'customers.printContract')}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('nav.customers')}>
        <button type="button" className="btn btn-primary" onClick={() => {
          setError('');
          if (tab === 'customers') setCustomerForm({ ...EMPTY_CUSTOMER });
          else setContractForm({ ...EMPTY_CONTRACT });
        }}>
          {t(tab === 'customers' ? 'customers.addCustomer' : 'customers.newContract')}
        </button>
      </PageHeader>

      <div className="commercial-tabs" role="tablist" aria-label={t('customers.manage')}>
        <button type="button" className={`commercial-tab ${tab === 'customers' ? 'active' : ''}`} onClick={() => setTab('customers')}>{t('customers.tabCustomers')} <span>{customers.length}</span></button>
        <button type="button" className={`commercial-tab ${tab === 'contracts' ? 'active' : ''}`} onClick={() => setTab('contracts')}>{t('customers.tabContracts')} <span>{contracts.length}</span></button>
      </div>

      {error && !customerForm && !contractForm && <div className="alert alert-error">{error}</div>}

      {tab === 'customers'
        ? <DataTable columns={customerColumns} data={customers} />
        : <DataTable columns={contractColumns} data={contracts} />}

      {customerForm && (
        <Modal title={t(customerForm.customer_id ? 'customers.editCustomer' : 'customers.addCustomer')} onClose={() => setCustomerForm(null)} footer={<><button type="button" className="btn" onClick={() => setCustomerForm(null)}>{t('common.cancel')}</button><button type="button" className="btn btn-primary" disabled={saving} onClick={saveCustomer}>{t(saving ? 'common.saving' : 'common.save')}</button></>}>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-row">
            <div className="form-group"><label htmlFor="customer-code">{t('customers.customerCode')}</label><input id="customer-code" className="form-input" placeholder={t('customers.autoIfBlank')} value={customerForm.customer_code || ''} onChange={(e) => setCustomerForm({ ...customerForm, customer_code: e.target.value })} /></div>
            <div className="form-group"><label htmlFor="customer-name">{t('customers.customerName')}</label><input id="customer-name" className="form-input" value={customerForm.customer_name || ''} onChange={(e) => setCustomerForm({ ...customerForm, customer_name: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label htmlFor="customer-contact">{t('customers.contactPerson')}</label><input id="customer-contact" className="form-input" value={customerForm.contact_person || ''} onChange={(e) => setCustomerForm({ ...customerForm, contact_person: e.target.value })} /></div>
            <div className="form-group"><label htmlFor="customer-phone">{t('common.phone')}</label><input id="customer-phone" className="form-input" value={customerForm.phone || ''} onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label htmlFor="customer-email">{t('customers.email')}</label><input id="customer-email" type="email" className="form-input" value={customerForm.email || ''} onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })} /></div>
            <div className="form-group"><label htmlFor="customer-tax">{t('customers.taxId')}</label><input id="customer-tax" className="form-input" value={customerForm.tax_id || ''} onChange={(e) => setCustomerForm({ ...customerForm, tax_id: e.target.value })} /></div>
          </div>
          <div className="form-group"><label htmlFor="billing-address">{t('customers.billingAddress')}</label><textarea id="billing-address" className="form-input" rows="2" value={customerForm.billing_address || ''} onChange={(e) => setCustomerForm({ ...customerForm, billing_address: e.target.value })} /></div>
          <div className="form-group"><label htmlFor="shipping-address">{t('customers.shippingAddress')}</label><textarea id="shipping-address" className="form-input" rows="2" value={customerForm.shipping_address || ''} onChange={(e) => setCustomerForm({ ...customerForm, shipping_address: e.target.value })} /></div>
          <div className="form-row">
            <div className="form-group"><label htmlFor="payment-terms">{t('customers.paymentTermsDays')}</label><input id="payment-terms" type="number" min="0" max="365" className="form-input" value={customerForm.payment_terms_days ?? 30} onChange={(e) => setCustomerForm({ ...customerForm, payment_terms_days: e.target.value })} /></div>
            <div className="form-group"><label htmlFor="customer-currency">{t('customers.currency')}</label><select id="customer-currency" className="form-input" value={customerForm.default_currency || 'VND'} onChange={(e) => setCustomerForm({ ...customerForm, default_currency: e.target.value })}><option value="VND">VND</option><option value="USD">USD</option></select></div>
          </div>
        </Modal>
      )}

      {contractForm && (
        <Modal title={t(contractForm.contract_id ? 'customers.editContract' : 'customers.newContract')} onClose={() => setContractForm(null)} footer={<><button type="button" className="btn" onClick={() => setContractForm(null)}>{t('common.cancel')}</button><button type="button" className="btn btn-primary" disabled={saving} onClick={saveContract}>{t(saving ? 'common.saving' : 'customers.saveContract')}</button></>}>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-row">
            <div className="form-group"><label htmlFor="contract-number">{t('customers.contractNumber')}</label><input id="contract-number" className="form-input" disabled={Boolean(contractForm.contract_id)} placeholder={t('customers.autoIfBlank')} value={contractForm.contract_number || ''} onChange={(e) => setContractForm({ ...contractForm, contract_number: e.target.value })} /></div>
            <div className="form-group"><label htmlFor="contract-customer">{t('customers.customerRequired')}</label><select id="contract-customer" className="form-input" disabled={Boolean(contractForm.contract_id)} value={contractForm.customer_id || ''} onChange={(e) => setContractForm({ ...contractForm, customer_id: e.target.value })}><option value="">{t('customers.pickCustomer')}</option>{activeCustomers.map((customer) => <option key={customer.customer_id} value={customer.customer_id}>{customer.customer_code} · {customer.customer_name}</option>)}</select></div>
          </div>
          <div className="form-group"><label htmlFor="contract-name">{t('customers.contractNameRequired')}</label><input id="contract-name" className="form-input" value={contractForm.contract_name || ''} onChange={(e) => setContractForm({ ...contractForm, contract_name: e.target.value })} /></div>
          <div className="form-row">
            <div className="form-group"><label htmlFor="contract-warehouse">{t('customers.warehouseScope')}</label><select id="contract-warehouse" className="form-input" value={contractForm.warehouse_id || ''} onChange={(e) => setContractForm({ ...contractForm, warehouse_id: e.target.value })}><option value="">{t('customers.allWarehouses')}</option>{warehouses.map((warehouse) => <option key={warehouse.warehouse_id} value={warehouse.warehouse_id}>{warehouse.warehouse_name || warehouse.warehouse_code}</option>)}</select></div>
            <div className="form-group"><label htmlFor="contract-status">{t('common.status')}</label><select id="contract-status" className="form-input" value={contractForm.status || 'DRAFT'} onChange={(e) => setContractForm({ ...contractForm, status: e.target.value })}>{['DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED'].map((status) => <option key={status}>{status}</option>)}</select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label htmlFor="contract-start">{t('customers.startDateRequired')}</label><input id="contract-start" type="date" className="form-input" value={contractForm.start_date || ''} onChange={(e) => setContractForm({ ...contractForm, start_date: e.target.value })} /></div>
            <div className="form-group"><label htmlFor="contract-end">{t('customers.endDate')}</label><input id="contract-end" type="date" className="form-input" value={contractForm.end_date || ''} onChange={(e) => setContractForm({ ...contractForm, end_date: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label htmlFor="billing-cycle">{t('customers.billingCycle')}</label><select id="billing-cycle" className="form-input" value={contractForm.billing_cycle || 'MONTHLY'} onChange={(e) => setContractForm({ ...contractForm, billing_cycle: e.target.value })}><option value="MONTHLY">{t('customers.cycleMonthly')}</option><option value="WEEKLY">{t('customers.cycleWeekly')}</option><option value="PER_EVENT">{t('customers.cyclePerEvent')}</option></select></div>
            <div className="form-group"><label htmlFor="contract-terms">{t('customers.paymentTerms')}</label><input id="contract-terms" type="number" min="0" max="365" className="form-input" value={contractForm.payment_terms_days ?? 30} onChange={(e) => setContractForm({ ...contractForm, payment_terms_days: e.target.value })} /></div>
          </div>
          <div className="form-group"><label htmlFor="contract-notes">{t('customers.termsNotes')}</label><textarea id="contract-notes" className="form-input" rows="4" value={contractForm.notes || ''} onChange={(e) => setContractForm({ ...contractForm, notes: e.target.value })} /></div>
        </Modal>
      )}
    </div>
  );
}
