import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import { useDirtyFormGuard } from '../hooks/useDirtyFormGuard.js';
import { useLocale } from '../i18n/locale.jsx';
import RichText from '../i18n/RichText.jsx';

export default function Settings() {
  const { t } = useLocale();
  const { warehouseId } = useWarehouse();
  const [warehouse, setWarehouse] = useState(null);
  const [whForm, setWhForm] = useState({});
  const [editingWh, setEditingWh] = useState(false);

  // Settings with save button
  const [savedSettings, setSavedSettings] = useState({});
  const [draftSettings, setDraftSettings] = useState({});
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsSuccess, setSettingsSuccess] = useState('');
  const [receivingBins, setReceivingBins] = useState([]);

  const hasUnsavedChanges = JSON.stringify(savedSettings) !== JSON.stringify(draftSettings);

  // v1.4.2 #100: browser-level warning only. Hook owns the
  // beforeunload listener. Intra-SPA sidebar clicks are NOT guarded;
  // deferred to v1.5 along with the rest of the design question.
  useDirtyFormGuard(hasUnsavedChanges);

  useEffect(() => {
    if (!warehouseId) return;
    api.get(`/admin/warehouses/${warehouseId}`).then(async (res) => {
      if (res?.ok) {
        const data = await res.json();
        setWarehouse(data);
        setWhForm(data);
      }
    });

    // Load all settings
    Promise.all([
      api.get('/admin/settings/count_show_expected'),
      api.get('/admin/settings/require_packing_before_shipping'),
      api.get('/admin/settings/allow_over_receiving'),
      api.get('/admin/settings/default_receiving_bin'),
      api.get('/admin/settings/require_count_approval_separation'),
      api.get('/admin/settings/picking_ticket_company_name'),
      api.get('/admin/settings/picking_ticket_company_address'),
      api.get('/admin/settings/picking_ticket_logo_url'),
      api.get('/admin/settings/picking_ticket_returns_text'),
      api.get('/admin/settings/pos_activity_enabled'),
      api.get('/admin/settings/fraud_review_billing_shipping'),
      api.get('/admin/settings/dashboard_bubble_origins'),
    ]).then(async (responses) => {
      const initial = {};
      for (const res of responses) {
        if (res?.ok) {
          const data = await res.json();
          initial[data.key] = data.value;
        }
      }
      // Set defaults for missing settings
      if (!('count_show_expected' in initial)) initial.count_show_expected = 'true';
      if (!('require_packing_before_shipping' in initial)) initial.require_packing_before_shipping = 'true';
      if (!('allow_over_receiving' in initial)) initial.allow_over_receiving = 'true';
      if (!('default_receiving_bin' in initial)) initial.default_receiving_bin = '';
      if (!('require_count_approval_separation' in initial)) initial.require_count_approval_separation = 'false';
      // Picking-ticket / packing-slip branding. All default to empty so a
      // fresh install prints a clean, unbranded slip until an operator
      // fills these in.
      if (!('picking_ticket_company_name' in initial)) initial.picking_ticket_company_name = '';
      if (!('picking_ticket_company_address' in initial)) initial.picking_ticket_company_address = '';
      if (!('picking_ticket_logo_url' in initial)) initial.picking_ticket_logo_url = '';
      if (!('picking_ticket_returns_text' in initial)) initial.picking_ticket_returns_text = '';
      // POS Activity tab is hidden by default; deployments using the POS
      // checkout surface opt in. Sidebar reads the same key to gate the nav.
      if (!('pos_activity_enabled' in initial)) initial.pos_activity_enabled = 'false';
      // Billing != shipping fraud heuristic is opt-in: off by default so
      // a fresh install never parks orders in FRAUD_REVIEW automatically.
      if (!('fraud_review_billing_shipping' in initial)) initial.fraud_review_billing_shipping = 'false';
      // Marketplace Health bubble set: a JSON array of {origin, label}. Empty
      // by default so the dashboard surfaces no channels until an operator
      // adds them; the dashboard endpoint reads the same key.
      if (!('dashboard_bubble_origins' in initial)) initial.dashboard_bubble_origins = '[]';
      setSavedSettings({ ...initial });
      setDraftSettings({ ...initial });
    });

    api.get(`/admin/bins?warehouse_id=${warehouseId}&bin_type=Staging`).then(async (res) => {
      if (res?.ok) {
        const data = await res.json();
        setReceivingBins(data.bins || []);
      }
    }).catch(() => {
      api.get(`/admin/bins?warehouse_id=${warehouseId}`).then(async (res) => {
        if (res?.ok) {
          const data = await res.json();
          setReceivingBins((data.bins || []).filter((b) => b.bin_type === 'Staging'));
        }
      }).catch(() => {});
    });
  }, [warehouseId]);

  function updateDraft(key, value) {
    setDraftSettings((prev) => ({ ...prev, [key]: value }));
    setSettingsSuccess('');
  }

  // Marketplace Health bubble set is stored as a JSON string in
  // draftSettings.dashboard_bubble_origins; parse / mutate / re-serialize
  // around the flat string the settings store keeps.
  function bubbleRows() {
    try {
      const parsed = JSON.parse(draftSettings.dashboard_bubble_origins || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function setBubbleRows(rows) {
    updateDraft('dashboard_bubble_origins', JSON.stringify(rows));
  }

  function updateBubble(i, field, value) {
    const rows = bubbleRows();
    rows[i] = { ...rows[i], [field]: value };
    setBubbleRows(rows);
  }

  function addBubble() {
    setBubbleRows([...bubbleRows(), { origin: '', label: '' }]);
  }

  function removeBubble(i) {
    const rows = bubbleRows();
    rows.splice(i, 1);
    setBubbleRows(rows);
  }

  async function saveSettings() {
    setSettingsSaving(true);
    setSettingsError('');
    setSettingsSuccess('');
    const res = await api.put('/admin/settings', { settings: draftSettings });
    if (res?.ok) {
      setSavedSettings({ ...draftSettings });
      setSettingsSuccess('Settings saved');
    } else {
      const data = await res?.json();
      setSettingsError(data?.error || 'Failed to save settings');
    }
    setSettingsSaving(false);
  }

  async function saveWarehouse() {
    const res = await api.put(`/admin/warehouses/${warehouseId}`, { warehouse_name: whForm.warehouse_name, address: whForm.address });
    if (res?.ok) {
      setWarehouse(await res.json());
      setEditingWh(false);
    }
  }

  const toBool = (v) => v !== 'false' && v !== false;

  return (
    <div>
      <PageHeader title={t('nav.settings')} />

      {/* Warehouse config */}
      <div className="settings-section">
        <h3>{t('common.warehouse')}</h3>
        {warehouse && !editingWh && (
          <div>
            <div className="detail-grid" style={{ marginBottom: 12 }}>
              <span className="detail-label">{t('common.name')}</span><span>{warehouse.warehouse_name}</span>
              <span className="detail-label">{t('bins.code')}</span><span className="mono">{warehouse.warehouse_code}</span>
              <span className="detail-label">{t('warehouses.address')}</span><span>{warehouse.address || '-'}</span>
            </div>
            <button className="btn btn-sm" onClick={() => setEditingWh(true)}>{t('common.edit')}</button>
          </div>
        )}
        {editingWh && (
          <div>
            <div className="form-group">
              <label>{t('common.name')}</label>
              <input className="form-input" value={whForm.warehouse_name || ''} onChange={(e) => setWhForm({ ...whForm, warehouse_name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('warehouses.address')}</label>
              <input className="form-input" value={whForm.address || ''} onChange={(e) => setWhForm({ ...whForm, address: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setEditingWh(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={saveWarehouse}>{t('common.save')}</button>
            </div>
          </div>
        )}
      </div>

      {/* Fulfillment Workflow */}
      <div className="settings-section">
        <h3>{t('settings.fulfillmentWorkflow')}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={toBool(draftSettings.require_packing_before_shipping)}
              onChange={(e) => updateDraft('require_packing_before_shipping', String(e.target.checked))}
            />
            {t('settings.requirePacking')}
          </label>
        </div>
        <p className="settings-note">{t('settings.requirePackingNote')}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', marginTop: 8 }}>
          <label style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{t('settings.defaultReceivingBin')}</label>
          <select
            className="form-select"
            style={{ width: 200 }}
            value={draftSettings.default_receiving_bin || ''}
            onChange={(e) => updateDraft('default_receiving_bin', e.target.value)}
          >
            <option value="">{t('settings.selectBin')}</option>
            {receivingBins.map((b) => (
              <option key={b.bin_id} value={String(b.bin_id)}>{b.bin_code}</option>
            ))}
          </select>
        </div>
        <p className="settings-note">{t('settings.defaultReceivingBinNote')}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={toBool(draftSettings.allow_over_receiving)}
              onChange={(e) => updateDraft('allow_over_receiving', String(e.target.checked))}
            />
            {t('settings.allowOverReceiving')}
          </label>
        </div>
        <p className="settings-note">{t('settings.allowOverReceivingNote')}</p>
      </div>

      {/* Mobile App Settings */}
      <div className="settings-section">
        <h3>{t('settings.mobileApp')}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={toBool(draftSettings.count_show_expected)}
              onChange={(e) => updateDraft('count_show_expected', String(e.target.checked))}
            />
            {t('settings.showExpected')}
          </label>
        </div>
        <p className="settings-note">{t('settings.showExpectedNote')}</p>
      </div>

      {/* Inventory */}
      <div className="settings-section">
        <h3>{t('nav.inventory')}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={toBool(draftSettings.require_count_approval_separation)}
              onChange={(e) => updateDraft('require_count_approval_separation', String(e.target.checked))}
            />
            {t('settings.separateApprover')}
          </label>
        </div>
        <p className="settings-note">{t('settings.separateApproverNote')}</p>
      </div>

      <div className="settings-section">
        <h3>{t('settings.section.pos')}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={toBool(draftSettings.pos_activity_enabled)}
              onChange={(e) => updateDraft('pos_activity_enabled', String(e.target.checked))}
            />
            {t('settings.showPosDashboard')}
          </label>
        </div>
        <p className="settings-note">{t('settings.showPosDashboardNote')}</p>
      </div>

      <div className="settings-section">
        <h3>{t('fraud.title')}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={toBool(draftSettings.fraud_review_billing_shipping)}
              onChange={(e) => updateDraft('fraud_review_billing_shipping', String(e.target.checked))}
            />
            {t('settings.autoFlagAddressMismatch')}
          </label>
        </div>
        <p className="settings-note">{t('settings.autoFlagNote')}</p>
      </div>

      <div className="settings-section">
        <h3>{t('dashboard.marketplaceHealth')}</h3>
        <p className="settings-note">
          <RichText
            text={t('settings.marketplaceNote')}
            values={{ field: <code>order_origin</code> }}
          />
        </p>
        {bubbleRows().map((b, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, padding: '4px 0', maxWidth: 560, alignItems: 'center' }}>
            <input
              className="form-input"
              style={{ flex: 1 }}
              value={b.origin || ''}
              onChange={(e) => updateBubble(i, 'origin', e.target.value)}
              placeholder={t('settings.originPlaceholder')}
            />
            <input
              className="form-input"
              style={{ flex: 1 }}
              value={b.label || ''}
              onChange={(e) => updateBubble(i, 'label', e.target.value)}
              placeholder={t('settings.labelPlaceholder')}
            />
            <button type="button" className="btn btn-secondary" onClick={() => removeBubble(i)}>
              {t('settings.remove')}
            </button>
          </div>
        ))}
        <div style={{ padding: '8px 0' }}>
          <button type="button" className="btn btn-secondary" onClick={addBubble}>
            {t('settings.addChannel')}
          </button>
        </div>
      </div>

      {/* Picking Ticket branding */}
      <div className="settings-section">
        <h3>{t('settings.pickingTicket')}</h3>
        <p className="settings-note">
          {t('settings.brandingNote')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0', maxWidth: 480 }}>
          <label style={{ fontSize: 13 }}>{t('settings.companyName')}</label>
          <input
            className="form-input"
            value={draftSettings.picking_ticket_company_name || ''}
            onChange={(e) => updateDraft('picking_ticket_company_name', e.target.value)}
            placeholder="e.g. Acme Distribution"
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0', maxWidth: 480 }}>
          <label style={{ fontSize: 13 }}>{t('settings.companyAddress')}</label>
          <textarea
            className="form-input"
            rows={4}
            value={draftSettings.picking_ticket_company_address || ''}
            onChange={(e) => updateDraft('picking_ticket_company_address', e.target.value)}
            placeholder={'One line per row, e.g.\n123 Warehouse Way\nSuite 100\nCity ST 00000'}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0', maxWidth: 480 }}>
          <label style={{ fontSize: 13 }}>{t('settings.logoUrl')}</label>
          <input
            className="form-input"
            value={draftSettings.picking_ticket_logo_url || ''}
            onChange={(e) => updateDraft('picking_ticket_logo_url', e.target.value)}
            placeholder={t('settings.logoPlaceholder')}
          />
          <p className="settings-note">{t('settings.logoNote')}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0', maxWidth: 480 }}>
          <label style={{ fontSize: 13 }}>{t('settings.returnsText')}</label>
          <textarea
            className="form-input"
            rows={3}
            value={draftSettings.picking_ticket_returns_text || ''}
            onChange={(e) => updateDraft('picking_ticket_returns_text', e.target.value)}
            placeholder="e.g. Returns accepted within 30 days. See example.com/returns."
          />
        </div>
      </div>

      {/* Save button */}
      <div className="settings-section" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={saveSettings} disabled={!hasUnsavedChanges || settingsSaving}>
          {t(settingsSaving ? 'common.saving' : 'settings.saveSettings')}
        </button>
        {hasUnsavedChanges && <span style={{ fontSize: 12, color: 'var(--copper)' }}>{t('settings.unsavedChanges')}</span>}
        {settingsSuccess && <span style={{ fontSize: 12, color: 'var(--success)' }}>{settingsSuccess}</span>}
        {settingsError && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{settingsError}</span>}
      </div>

      {/* About */}
      <div className="settings-section">
        <h3>{t('settings.about')}</h3>
        <div className="detail-grid">
          <span className="detail-label">{t('settings.version')}</span><span className="mono">1.37.0</span>
          <span className="detail-label">{t('settings.repository')}</span><span><a href="https://github.com/hightower-systems/sentry-wms" target="_blank" rel="noopener noreferrer">github.com/hightower-systems/sentry-wms</a></span>
        </div>
      </div>

      {/* PO Modal */}

    </div>
  );
}
