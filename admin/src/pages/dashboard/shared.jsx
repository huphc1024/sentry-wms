import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useWarehouse } from '../../warehouse.jsx';
import { useLocale } from '../../i18n/locale.jsx';

/** Fetches a dashboard endpoint for the active warehouse and day range. */
export function useDashboardData(path, days) {
  const { warehouseId } = useWarehouse();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!warehouseId) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFailed(false);
      try {
        const qp = new URLSearchParams({ warehouse_id: String(warehouseId), days: String(days) });
        const res = await api.get(`${path}?${qp}`, { silentPermissionDenied: true });
        if (cancelled) return;
        if (res?.ok) {
          setData(await res.json());
        } else {
          setData(null);
          setFailed(true);
        }
      } catch {
        if (!cancelled) { setData(null); setFailed(true); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [path, days, warehouseId]);

  return { warehouseId, data, loading, failed };
}

export function RangeSelector({ value, onChange, options }) {
  const { t } = useLocale();
  return (
    <div
      role="group"
      aria-label={t('dashboardOverview.rangeLabel')}
      style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}
    >
      {options.map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={value === n}
          className={`btn btn-sm${value === n ? ' btn-primary' : ''}`}
          onClick={() => onChange(n)}
        >
          {t('dashboardOverview.rangeDays', { n })}
        </button>
      ))}
    </div>
  );
}

export function KpiGrid({ items }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: 12,
        marginBottom: 16,
      }}
    >
      {items.map((k) => (
        <div
          key={k.key}
          className="card"
          data-testid={`kpi-${k.key}`}
          style={{ padding: 14 }}
        >
          <div
            style={{
              fontSize: 11, color: 'var(--text-secondary)',
              textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6,
            }}
          >
            {k.label}
          </div>
          <div
            style={{
              fontSize: 26, fontWeight: 700, lineHeight: 1,
              fontFamily: 'var(--mono, monospace)',
              color: k.tone ? `var(--${k.tone})` : 'var(--text)',
            }}
          >
            {Number(k.value ?? 0).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChartPanel({ title, empty, children }) {
  const { t } = useLocale();
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {empty ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
          {t('dashboardOverview.noData')}
        </div>
      ) : children}
    </div>
  );
}

export const CHART_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
  gap: 16,
  marginBottom: 16,
};

/** Loading / failure / no-warehouse states for a tab with no data yet. */
export function DataState({ warehouseId, loading, failed }) {
  const { t } = useLocale();
  if (!warehouseId) {
    return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>{t('dashboardOverview.selectWarehouse')}</div>;
  }
  if (failed) return <div className="form-error">{t('dashboardOverview.loadFailed')}</div>;
  if (loading) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>{t('common.loading')}</div>;
  }
  return null;
}
