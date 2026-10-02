import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { friendlyError } from '../utils/friendlyError.js';
import { useLocale } from '../i18n/locale.jsx';
import RichText from '../i18n/RichText.jsx';

export default function Integrations() {
  const { t } = useLocale();
  const { warehouseId } = useWarehouse();

  const [connectors, setConnectors] = useState([]);
  const [selectedConnector, setSelectedConnector] = useState(null);
  const [credForm, setCredForm] = useState({});
  const [credSaving, setCredSaving] = useState(false);
  const [credMsg, setCredMsg] = useState('');
  const [credError, setCredError] = useState('');
  const [storedKeys, setStoredKeys] = useState([]);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [syncStates, setSyncStates] = useState([]);
  const [syncingTypes, setSyncingTypes] = useState({});

  useEffect(() => {
    api.get('/admin/connectors').then(async (res) => {
      if (res?.ok) {
        const data = await res.json();
        setConnectors(data.connectors || []);
      }
    }).catch(() => {});
  }, []);

  function selectConnector(conn) {
    setSelectedConnector(conn);
    setCredForm({});
    setCredMsg('');
    setCredError('');
    setTestResult(null);
    setSyncStates([]);
    if (warehouseId) {
      api.get(`/admin/connectors/${conn.name}/credentials?warehouse_id=${warehouseId}`).then(async (res) => {
        if (res?.ok) {
          const data = await res.json();
          setStoredKeys(data.credentials || []);
        }
      }).catch(() => setStoredKeys([]));

      loadSyncStates(conn.name);
    }
  }

  async function loadSyncStates(connectorName) {
    try {
      const res = await api.get(`/admin/connectors/${connectorName}/sync-status?warehouse_id=${warehouseId}`);
      if (res?.ok) {
        const data = await res.json();
        setSyncStates(data.sync_states || []);
      }
    } catch { /* ignore */ }
  }

  function syncStateColor(state) {
    if (!state) return 'var(--text-secondary)';
    if (state.sync_status === 'error') return 'var(--danger)';
    if (state.consecutive_errors > 0) return 'var(--warning)';
    return 'var(--success)';
  }

  function syncStateLabel(state) {
    if (!state) return 'Never synced';
    if (state.sync_status === 'running') return 'Running...';
    if (state.sync_status === 'error') {
      return t('integrations.errorFailures', { n: state.consecutive_errors });
    }
    if (state.consecutive_errors > 0) {
      return t('integrations.lastAttemptFailed', { n: state.consecutive_errors });
    }
    return t('integrations.healthy');
  }

  async function triggerSync(syncType) {
    if (!selectedConnector || !warehouseId) return;
    setSyncingTypes((prev) => ({ ...prev, [syncType]: true }));
    try {
      const res = await api.post(`/admin/connectors/${selectedConnector.name}/sync/${syncType}`, {
        warehouse_id: warehouseId,
      });
      if (res?.status === 409) {
        setCredError('Sync already running');
      } else if (res?.ok || res?.status === 202) {
        setCredMsg(`${syncType} sync queued`);
        setTimeout(() => loadSyncStates(selectedConnector.name), 1000);
      } else {
        const data = await res.json().catch(() => ({}));
        setCredError(friendlyError(data, 'Sync failed. Please try again.'));
      }
    } catch { setCredError(t('integrations.syncError')); }
    setSyncingTypes((prev) => ({ ...prev, [syncType]: false }));
  }

  async function saveCredentials() {
    if (!selectedConnector || !warehouseId) return;
    setCredSaving(true);
    setCredMsg('');
    setCredError('');
    try {
      const res = await api.post(`/admin/connectors/${selectedConnector.name}/credentials`, {
        warehouse_id: warehouseId,
        credentials: credForm,
      });
      if (res?.ok) {
        setCredMsg('Credentials saved');
        setCredForm({});
        selectConnector(selectedConnector);
      } else {
        const data = await res.json().catch(() => ({}));
        setCredError(friendlyError(data, 'Failed to save credentials.'));
      }
    } catch { setCredError(t('integrations.connectionError')); }
    setCredSaving(false);
  }

  async function testConnectorConnection() {
    if (!selectedConnector || !warehouseId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post(`/admin/connectors/${selectedConnector.name}/test`, {
        warehouse_id: warehouseId,
      });
      if (res?.ok) {
        const data = await res.json();
        setTestResult(data);
      } else {
        const data = await res.json().catch(() => ({}));
        setTestResult({ connected: false, message: friendlyError(data, t('integrations.testFailed')) });
      }
    } catch { setTestResult({ connected: false, message: t('integrations.connectionError') }); }
    setTesting(false);
  }

  async function deleteConnectorCredentials() {
    if (!selectedConnector || !warehouseId) return;
    if (!confirm(t('integrations.deleteCredsConfirm'))) return;
    try {
      const res = await api.delete(`/admin/connectors/${selectedConnector.name}/credentials`);
      if (res?.ok) {
        setCredMsg('Credentials deleted');
        setStoredKeys([]);
      }
    } catch { setCredError(t('integrations.deleteFailed')); }
  }

  return (
    <div>
      <PageHeader title={t('nav.integrations')} />

      <div className="settings-section">
        <h3>{t('integrations.available')}</h3>
        <p className="settings-note">
          {t('integrations.intro')}
        </p>
        {connectors.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            <RichText
              text={t('integrations.noConnectors')}
              values={{
                path: <span className="mono">api/connectors/</span>, /* i18n-ignore: a path */
                guide: (
                  <a
                    href="https://hightower-systems.github.io/sentry-wms/connectors/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('integrations.frameworkGuide')}
                  </a>
                ),
              }}
            />
          </p>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {connectors.map((c) => (
              <button
                key={c.name}
                className={`btn ${selectedConnector?.name === c.name ? 'btn-primary' : ''}`}
                onClick={() => selectConnector(c)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {selectedConnector && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16, background: 'var(--panel)' }}>
            <h4 style={{ marginTop: 0 }}>{selectedConnector.name}</h4>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {t('integrations.capabilities', {
                list: selectedConnector.capabilities.join(', '),
              })}
            </p>

            {storedKeys.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <strong style={{ fontSize: 13 }}>{t('integrations.storedCredentials')}</strong>
                <div style={{ marginTop: 4 }}>
                  {storedKeys.map((k) => (
                    <div key={k.key} style={{ fontSize: 13, fontFamily: 'monospace' }}>
                      {k.key}: {k.value}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <strong style={{ fontSize: 13 }}>{t('integrations.syncHealth')}</strong>
              <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                {['orders', 'items', 'inventory'].map((syncType) => {
                  const state = syncStates.find((s) => s.sync_type === syncType);
                  const color = syncStateColor(state);
                  const label = syncStateLabel(state);
                  const isRunning = state?.sync_status === 'running' || syncingTypes[syncType];
                  return (
                    <div
                      key={syncType}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: 8,
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                        fontSize: 13,
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: color,
                        }}
                      />
                      <strong style={{ minWidth: 90, textTransform: 'capitalize' }}>{syncType}</strong>
                      <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{label}</span>
                      {state?.last_synced_at && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                          {t('integrations.lastSynced', {
                            when: new Date(state.last_synced_at).toLocaleString(),
                          })}
                        </span>
                      )}
                      <button
                        className="btn"
                        onClick={() => triggerSync(syncType)}
                        disabled={isRunning}
                      >
                        {t(isRunning ? 'integrations.syncing' : 'integrations.syncNow')}
                      </button>
                    </div>
                  );
                })}
              </div>
              {syncStates.some((s) => s.last_error_message) && (
                <div style={{ marginTop: 8 }}>
                  {syncStates.filter((s) => s.last_error_message).map((s) => (
                    <div key={s.sync_type} style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>
                      {s.sync_type}: {s.last_error_message}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              {Object.entries(selectedConnector.config_schema).map(([key, schema]) => (
                <div key={key} className="form-group" style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 13 }}>
                    {schema.label || key} {schema.required && <span style={{ color: 'var(--danger)' }}>*</span>}
                  </label>
                  <input
                    className="form-input"
                    type="password"
                    placeholder={schema.description || key}
                    value={credForm[key] || ''}
                    onChange={(e) => setCredForm({ ...credForm, [key]: e.target.value })}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={saveCredentials} disabled={credSaving || Object.keys(credForm).length === 0}>
                {t(credSaving ? 'common.saving' : 'integrations.saveCredentials')}
              </button>
              <button className="btn" onClick={testConnectorConnection} disabled={testing}>
                {t(testing ? 'integrations.testing' : 'integrations.testConnection')}
              </button>
              {storedKeys.length > 0 && (
                <button className="btn btn-danger" onClick={deleteConnectorCredentials}>{t('integrations.deleteCredentials')}</button>
              )}
            </div>

            {credMsg && <p style={{ color: 'var(--success)', fontSize: 13, marginTop: 8 }}>{credMsg}</p>}
            {credError && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{credError}</p>}
            {testResult && (
              <p style={{ color: testResult.connected ? 'var(--success)' : 'var(--danger)', fontSize: 13, marginTop: 8 }}>
                {t(testResult.connected ? 'integrations.connected' : 'integrations.failed')}
                {': '}
                {testResult.message}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
