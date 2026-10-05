import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { useLocale } from '../i18n/locale.jsx';

// Nhãn tiếng Việt cho từng feature key. Danh sách key thật lấy từ
// server (all_feature_keys) chứ không hardcode ở đây: nếu backend thêm
// key mới mà trang này chưa có nhãn thì vẫn hiện ra (dùng chính key làm
// nhãn) thay vì biến mất khỏi UI và không ai gán được.
// Keyed, because the labels render in a checkbox list and a summary
// column. The keys themselves are the portal's feature flags and come
// back from the API, so an unknown one falls through to its own name.
const FEATURE_LABEL_KEYS = {
  inventory: 'customerUsers.featureInventory',
  orders: 'customerUsers.featureOrders',
  inbound: 'customerUsers.featureInbound',
  invoices: 'customerUsers.featureInvoices',
  reports: 'customerUsers.featureReports',
};

const EMPTY_FORM = { feature_keys: [], must_change_password: true };

async function responseError(res, fallback) {
  const data = await res?.json().catch(() => ({}));
  if (data?.unknown?.length) return `${data.error}: ${data.unknown.join(', ')}`;
  return data?.error || fallback;
}

export default function CustomerUsers() {
  const { t } = useLocale();
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [allFeatureKeys, setAllFeatureKeys] = useState(Object.keys(FEATURE_LABEL_KEYS));
  const [form, setForm] = useState(null);
  const [featureForm, setFeatureForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [userRes, customerRes] = await Promise.all([
      api.get('/admin/customer-users?per_page=1000'),
      api.get('/admin/customers'),
    ]);
    if (userRes?.ok) setRows((await userRes.json()).customer_users || []);
    if (customerRes?.ok) setCustomers((await customerRes.json()).customers || []);
  }, []);

  // Initial remote-data hydration is intentionally effect-driven.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const activeCustomers = useMemo(
    () => customers.filter((c) => c.is_active),
    [customers],
  );

  async function save() {
    if (!form?.customer_id) { setError(t('customerUsers.customerRequired')); return; }
    if (!form.customer_user_id) {
      if (!form.username?.trim()) { setError(t('customerUsers.usernameRequired')); return; }
      if (!form.password) { setError(t('customerUsers.passwordRequired')); return; }
      if (!form.full_name?.trim()) { setError(t('customerUsers.fullNameRequired')); return; }
    }
    setSaving(true); setError('');

    let res;
    if (form.customer_user_id) {
      // Chỉ gửi những field endpoint PUT nhận. customer_id không nằm
      // trong đó: đổi khách hàng của một tài khoản sẽ lặng lẽ chuyển
      // hướng mọi truy vấn nó thực hiện, nên đó là xóa-và-tạo-lại chứ
      // không phải sửa. Gửi kèm sẽ bị từ chối 400 (extra="forbid").
      const body = {
        full_name: form.full_name,
        email: form.email || null,
        is_active: form.is_active,
      };
      if (form.password) body.password = form.password;
      res = await api.put(`/admin/customer-users/${form.customer_user_id}`, body);
    } else {
      res = await api.post('/admin/customer-users', {
        customer_id: form.customer_id,
        username: form.username.trim(),
        password: form.password,
        full_name: form.full_name.trim(),
        email: form.email || null,
        feature_keys: form.feature_keys || [],
        must_change_password: form.must_change_password !== false,
      });
    }

    setSaving(false);
    if (!res?.ok) { setError(await responseError(res, t('customerUsers.saveFailed'))); return; }
    setForm(null); await load();
  }

  async function openFeatures(row) {
    setError('');
    const res = await api.get(`/admin/customer-users/${row.customer_user_id}/features`);
    if (!res?.ok) { setError(await responseError(res, t('customerUsers.loadFeaturesFailed'))); return; }
    const data = await res.json();
    if (data.all_feature_keys?.length) setAllFeatureKeys(data.all_feature_keys);
    setFeatureForm({
      customer_user_id: row.customer_user_id,
      username: row.username,
      feature_keys: data.feature_keys || [],
    });
  }

  async function saveFeatures() {
    setSaving(true); setError('');
    const res = await api.put(
      `/admin/customer-users/${featureForm.customer_user_id}/features`,
      { feature_keys: featureForm.feature_keys },
    );
    setSaving(false);
    if (!res?.ok) { setError(await responseError(res, t('customerUsers.saveFeaturesFailed'))); return; }
    setFeatureForm(null); await load();
  }

  async function deactivate(row) {
    setError('');
    const res = await api.delete(`/admin/customer-users/${row.customer_user_id}`);
    if (!res?.ok) { setError(await responseError(res, t('customerUsers.deactivateFailed'))); return; }
    await load();
  }

  function toggleFeature(list, key) {
    return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  }

  const columns = [
    { key: 'username', labelKey: 'common.username' },
    { key: 'full_name', labelKey: 'common.fullName' },
    {
      key: 'customer_code',
      labelKey: 'common.customer',
      render: (row) => `${row.customer_code || '-'} · ${row.customer_name || ''}`,
    },
    { key: 'email', labelKey: 'customers.email', render: (row) => row.email || '-' },
    {
      key: 'feature_keys',
      labelKey: 'customerUsers.features',
      render: (row) => (row.feature_keys?.length
        ? row.feature_keys.map((k) => (FEATURE_LABEL_KEYS[k] ? t(FEATURE_LABEL_KEYS[k]) : k)).join(', ')
        // Không có quyền nào là trạng thái hợp lệ, không phải lỗi: tài
        // khoản vẫn đăng nhập và đổi mật khẩu được, ngoài ra không thấy gì.
        : t('customerUsers.noFeatures')),
    },
    {
      key: 'must_change_password',
      labelKey: 'customerUsers.mustChange',
      render: (row) => (row.must_change_password ? t('customerUsers.required') : '-'),
    },
    {
      key: 'last_login',
      labelKey: 'customerUsers.lastLogin',
      render: (row) => (row.last_login ? new Date(row.last_login).toLocaleString('vi-VN') : 'Chưa'),
    },
    {
      key: 'is_active',
      labelKey: 'common.status',
      render: (row) => (
        <span className={`status-tag ${row.is_active ? 'status-active' : 'status-cancelled'}`}>
          {t(row.is_active ? 'customers.statusActive' : 'customers.statusInactive')}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-sm" onClick={() => { setError(''); setForm({ ...row, password: '' }); }}>{t('common.edit')}</button>
          <button type="button" className="btn btn-sm" onClick={() => openFeatures(row)}>{t('customerUsers.features')}</button>
          {row.is_active && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => deactivate(row)}>{t('customers.statusInactive')}</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('nav.customerUsers')}>
        <button type="button" className="btn btn-primary" onClick={() => { setError(''); setForm({ ...EMPTY_FORM }); }}>
          {t('customerUsers.addAccount')}
        </button>
      </PageHeader>

      {error && !form && !featureForm && <div className="alert alert-error">{error}</div>}

      <DataTable columns={columns} data={rows} rowKey="customer_user_id" />

      {form && (
        <Modal
          title={t(form.customer_user_id
            ? 'customerUsers.editAccount'
            : 'customerUsers.addCustomerAccount')}
          onClose={() => setForm(null)}
          footer={(
            <>
              <button type="button" className="btn" onClick={() => setForm(null)}>{t('common.cancel')}</button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
                {t(saving ? 'common.saving' : 'common.save')}
              </button>
            </>
          )}
        >
          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="cu-customer">{t('customers.customerRequired')}</label>
            <select
              id="cu-customer"
              className="form-input"
              // Không cho đổi sau khi tạo: xem ghi chú trong save().
              disabled={Boolean(form.customer_user_id)}
              value={form.customer_id || ''}
              onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
            >
              <option value="">{t('customers.pickCustomer')}</option>
              {activeCustomers.map((c) => (
                <option key={c.customer_id} value={c.customer_id}>
                  {c.customer_code} · {c.customer_name}
                </option>
              ))}
            </select>
            {form.customer_user_id && (
              <small className="form-hint">
                {t('customerUsers.customerFixedHint')}
              </small>
            )}
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="cu-username">{t('customerUsers.usernameLabel')}</label>
              <input
                id="cu-username"
                className="form-input"
                disabled={Boolean(form.customer_user_id)}
                value={form.username || ''}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="cu-fullname">{t('customerUsers.fullNameLabel')}</label>
              <input
                id="cu-fullname"
                className="form-input"
                value={form.full_name || ''}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="cu-email">{t('customers.email')}</label>
              <input
                id="cu-email"
                type="email"
                className="form-input"
                value={form.email || ''}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="cu-password">
                {t(form.customer_user_id
                  ? 'customerUsers.resetPassword'
                  : 'customerUsers.passwordLabel')}
              </label>
              <input
                id="cu-password"
                type="password"
                className="form-input"
                placeholder={form.customer_user_id ? t('customerUsers.blankToKeep') : ''}
                value={form.password || ''}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              {form.customer_user_id && (
                <small className="form-hint">
                  Đặt lại mật khẩu sẽ đăng xuất mọi phiên đang hoạt động của tài khoản này
                  và bắt đổi mật khẩu ở lần đăng nhập tới.
                </small>
              )}
            </div>
          </div>

          {!form.customer_user_id && (
            <>
              <div className="form-group">
                <label htmlFor="cu-features-new">{t('customerUsers.accessFeatures')}</label>
                <div id="cu-features-new" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {allFeatureKeys.map((key) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={(form.feature_keys || []).includes(key)}
                        onChange={() => setForm({
                          ...form,
                          feature_keys: toggleFeature(form.feature_keys || [], key),
                        })}
                      />
                      {FEATURE_LABEL_KEYS[key] ? t(FEATURE_LABEL_KEYS[key]) : key}
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={form.must_change_password !== false}
                    onChange={(e) => setForm({ ...form, must_change_password: e.target.checked })}
                  />
                  {t('customerUsers.forceChange')}
                </label>
                <small className="form-hint">
                  {t('customerUsers.forceChangeHint')}
                </small>
              </div>
            </>
          )}

          {form.customer_user_id && (
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={form.is_active !== false}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                {t('customers.statusActive')}
              </label>
            </div>
          )}
        </Modal>
      )}

      {featureForm && (
        <Modal
          title={t('customerUsers.featuresOf', { user: featureForm.username })}
          onClose={() => setFeatureForm(null)}
          footer={(
            <>
              <button type="button" className="btn" onClick={() => setFeatureForm(null)}>{t('common.cancel')}</button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={saveFeatures}>
                {t(saving ? 'common.saving' : 'customerUsers.saveFeatures')}
              </button>
            </>
          )}
        >
          {error && <div className="alert alert-error">{error}</div>}
          <p className="form-hint">
            {t('customerUsers.noFeaturesHint')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {allFeatureKeys.map((key) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={featureForm.feature_keys.includes(key)}
                  onChange={() => setFeatureForm({
                    ...featureForm,
                    feature_keys: toggleFeature(featureForm.feature_keys, key),
                  })}
                />
                {FEATURE_LABEL_KEYS[key] ? t(FEATURE_LABEL_KEYS[key]) : key}
              </label>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
