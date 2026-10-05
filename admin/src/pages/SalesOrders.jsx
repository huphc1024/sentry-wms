import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { formatDateOnly } from '../utils/date.js';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import StatusTag from '../components/StatusTag.jsx';
import SalesOrderModal from '../components/SalesOrderModal.jsx';
import OrderLineEditor from '../components/OrderLineEditor.jsx';
import { emptyOrderLine, resolveOrderLines } from '../utils/orderLines.js';
import { useLocale } from '../i18n/locale.jsx';
import { useWarehouse } from '../warehouse.jsx';

const STATUS_OPTIONS = ['All', 'OPEN', 'PICKED', 'PACKED', 'SHIPPED', 'CANCELLED', 'REFUNDED'];

function emptySoCreateForm(warehouseId) {
  return {
    so_number: '',
    warehouse_id: warehouseId || '',
    customer_name: '',
    customer_phone: '',
    customer_address: '',
    ship_method: '',
    ship_by_date: '',
    lines: [emptyOrderLine()],
  };
}

export default function SalesOrders() {
  const { t } = useLocale();
  const [searchParams] = useSearchParams();
  const { warehouses = [], warehouseId } = useWarehouse() || {};
  // Manual SO entry. Same story as the PO page: the create form existed
  // only under Settings > Manual Entry, which is not where anyone looks
  // for it when a customer phones an order in.
  const [createForm, setCreateForm] = useState(null);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [orders, setOrders] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('All');
  const [successBanner, setSuccessBanner] = useState('');
  // Which order the modal is showing, and which surface. Both cleared on
  // close. The modal owns everything else about itself, including moving
  // between related records.
  const [openSoId, setOpenSoId] = useState(null);
  const [openMode, setOpenMode] = useState('view');

  useEffect(() => { loadOrders(); }, [page, statusFilter, search]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ?focus=<so_number> deep-link, used by the Teams adaptive card
  // so the operator goes straight to the order instead of hunting for the
  // row in the list. Effect runs once per focus param change; looks up the
  // SO by number via the list endpoint and opens the modal on the first
  // match.
  //
  // : this opened the EDIT form while clicking a row on this same page
  // opened the read-only view. Same apparent action, two destinations, and
  // the deep-link reached the more dangerous one. It also meant operators
  // arriving from a Teams ping landed in a textarea, which is why the memo
  // was reported as "only visible if you edit the order" -- the read-only
  // view has always rendered it. Both now resolve to the view.
  useEffect(() => {
    const target = searchParams.get('focus');
    if (!target) return;
    let cancelled = false;
    (async () => {
      const qs = new URLSearchParams({ q: target, per_page: '1' });
      const res = await api.get(`/admin/sales-orders?${qs.toString()}`);
      if (!res?.ok || cancelled) return;
      const data = await res.json();
      const row = (data.sales_orders || []).find(
        (r) => String(r.so_number).toLowerCase() === String(target).toLowerCase(),
      );
      if (row && !cancelled) { setOpenMode('view'); setOpenSoId(row.so_id); } // i18n-ignore
    })();
    return () => { cancelled = true; };
  }, [searchParams]);

  async function submitCreate() {
    setCreateError('');
    if (!String(createForm.so_number || '').trim()) {
      setCreateError(t('salesOrders.soNumberRequired'));
      return;
    }
    if (!createForm.warehouse_id) {
      setCreateError(t('salesOrders.warehouseRequired'));
      return;
    }
    const { lines, error } = await resolveOrderLines(createForm.lines);
    if (error) {
      setCreateError(error);
      return;
    }

    setCreating(true);
    const address = createForm.customer_address.trim() || null;
    const res = await api.post('/admin/sales-orders', {
      so_number: createForm.so_number.trim(),
      warehouse_id: Number(createForm.warehouse_id),
      customer_name: createForm.customer_name.trim() || null,
      customer_phone: createForm.customer_phone.trim() || null,
      customer_address: address,
      // The picking ticket prints ship_address; keeping the two in step
      // means an order typed here produces the same label as one that
      // arrived from a marketplace.
      ship_address: address,
      ship_method: createForm.ship_method.trim() || null,
      ship_by_date: createForm.ship_by_date || null,
      lines,
    });
    setCreating(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => null);
      setCreateError(data?.error || t('salesOrders.failedCreate'));
      return;
    }
    setCreateForm(null);
    setPage(1);
    await loadOrders();
  }

  async function loadOrders() {
    const qp = new URLSearchParams({ page: String(page), per_page: '50' });
    if (statusFilter !== 'All') qp.set('status', statusFilter);
    if (search) qp.set('q', search);
    // Returns (RMAs) + refunds (credit memos) live on the Returns page, not
    // the sales ledger.
    qp.set('exclude_post_fulfillment', 'true');
    const res = await api.get(`/admin/sales-orders?${qp}`);
    if (res?.ok) {
      const data = await res.json();
      setOrders(data.sales_orders || []);
      setPagination({ page: data.page, pages: data.pages, total: data.total });
    }
  }

  function openView(so) { setOpenMode('view'); setOpenSoId(so.so_id); }
  function openEdit(so) { setOpenMode('edit'); setOpenSoId(so.so_id); } // i18n-ignore

  // onChanged carries an optional banner message from the modal (partial
  // fulfill, admin pick, admin ship). The banner lives here because it
  // belongs to the list the operator returns to.
  function handleChanged(payload) {
    loadOrders();
    if (payload?.message) {
      setSuccessBanner(payload.message);
      setTimeout(() => setSuccessBanner(''), 6000);
    }
  }

  const columns = [
    { key: 'so_number', labelKey: 'salesOrders.number', mono: true },
    { key: 'customer_name', labelKey: 'common.customer' },
    { key: 'ship_by_date', labelKey: 'salesOrders.shipBy', mono: true, render: (r) => r.ship_by_date ? formatDateOnly(r.ship_by_date) : '-' },
    { key: 'status', labelKey: 'common.status', render: (r) => <StatusTag status={r.status} /> },
    { key: 'created_at', labelKey: 'salesOrders.created', render: (r) => r.created_at ? new Date(r.created_at).toLocaleDateString() : '-' },
    { key: 'actions', label: '', render: (r) => (
      <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(r); }} aria-label={t('common.edit')} title={t('common.edit')}>&#9998;</button>
    )},
  ];

  return (
    <div>
      <PageHeader title={t('nav.salesOrders')}>
        <button className="btn btn-primary" onClick={() => { setCreateError(''); setCreateForm(emptySoCreateForm(warehouseId)); }}>
          {t('salesOrders.newOrder')}
        </button>
      </PageHeader>
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

      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('common.status')}:</label>
        <select className="form-select" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={{ width: 160 }}>
          {/* The column beside this one renders status through
              `status.*`, so the filter has to as well -- otherwise the
              list says MỞ and the dropdown above it says OPEN. */}
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === 'All' ? t('common.all') : t(`status.${s}`)}
            </option>
          ))}
        </select>
        <input
          className="form-input"
          style={{ maxWidth: 320 }}
          placeholder={t('salesOrders.searchPlaceholder')}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      <DataTable
        rowKey="so_id"
        columns={columns}
        data={orders}
        pagination={pagination}
        onPageChange={setPage}
        onRowClick={openView}
        clickColumn="so_number"
        emptyMessageKey="salesOrders.empty"
      />

      <SalesOrderModal
        soId={openSoId}
        mode={openMode}
        onClose={() => setOpenSoId(null)}
        onChanged={handleChanged}
      />

      {createForm && (
        <Modal
          title={t('salesOrders.newOrder')}
          onClose={() => setCreateForm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setCreateForm(null)} disabled={creating}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={submitCreate} disabled={creating}>
                {creating ? t('salesOrders.creating') : t('salesOrders.createOrder')}
              </button>
            </>
          }
        >
          {createError && <div className="alert alert-error">{createError}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label htmlFor="so-create-number">{t('salesOrders.number')}</label>
              <input
                id="so-create-number"
                className="form-input mono"
                value={createForm.so_number}
                onChange={(e) => setCreateForm({ ...createForm, so_number: e.target.value })}
                placeholder="SO-2026-010"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="so-create-warehouse">{t('common.warehouse')}</label>
              <select
                id="so-create-warehouse"
                className="form-input"
                value={createForm.warehouse_id}
                onChange={(e) => setCreateForm({ ...createForm, warehouse_id: e.target.value })}
              >
                <option value="">{t('salesOrders.selectWarehouse')}</option>
                {warehouses.map((w) => (
                  <option key={w.warehouse_id || w.id} value={w.warehouse_id || w.id}>
                    {w.warehouse_code} &middot; {w.warehouse_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="so-create-customer">{t('common.customer')}</label>
              <input
                id="so-create-customer"
                className="form-input"
                value={createForm.customer_name}
                onChange={(e) => setCreateForm({ ...createForm, customer_name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="so-create-phone">{t('common.phone')}</label>
              <input
                id="so-create-phone"
                className="form-input"
                value={createForm.customer_phone}
                onChange={(e) => setCreateForm({ ...createForm, customer_phone: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="so-create-ship-method">{t('salesOrders.shipMethod')}</label>
              <input
                id="so-create-ship-method"
                className="form-input"
                value={createForm.ship_method}
                onChange={(e) => setCreateForm({ ...createForm, ship_method: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="so-create-ship-by">{t('salesOrders.shipByDate')}</label>
              <input
                id="so-create-ship-by"
                className="form-input"
                type="date"
                value={createForm.ship_by_date}
                onChange={(e) => setCreateForm({ ...createForm, ship_by_date: e.target.value })}
              />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="so-create-address">{t('salesOrders.shippingAddress')}</label>
            <textarea
              id="so-create-address"
              className="form-input"
              rows={2}
              value={createForm.customer_address}
              onChange={(e) => setCreateForm({ ...createForm, customer_address: e.target.value })}
            />
          </div>
          <h4 style={{ margin: '16px 0 8px', fontSize: 13, color: 'var(--text-secondary)' }}>{t('salesOrders.lines')}</h4>
          <OrderLineEditor
            lines={createForm.lines}
            onChange={(lines) => setCreateForm({ ...createForm, lines })}
            listIdPrefix="so-create"
            disabled={creating}
          />
          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('salesOrders.createStockNote')}
          </p>
        </Modal>
      )}
    </div>
  );
}
