import { useState } from 'react';
import AiSuggestions from '../../components/AiSuggestions.jsx';
import BarChartBasic from '../../components/charts/BarChartBasic.jsx';
import TimeSeriesChart from '../../components/charts/TimeSeriesChart.jsx';
import { SERIES_COLORS } from '../../components/charts/palette.js';
import { useLocale } from '../../i18n/locale.jsx';
import {
  CHART_GRID, ChartPanel, DataState, KpiGrid, RangeSelector, useDashboardData,
} from './shared.jsx';

const RANGES = [7, 14, 30];

const KPI_DEFS = [
  ['orders_open', 'dashboardOverview.kpiOrdersOpen'],
  ['orders_picked', 'dashboardOverview.kpiOrdersPicked'],
  ['orders_packed', 'dashboardOverview.kpiOrdersPacked'],
  ['orders_shipped_today', 'dashboardOverview.kpiOrdersShippedToday'],
  ['backorders', 'dashboardOverview.kpiBackorders', 'warning'],
  ['low_stock_items', 'dashboardOverview.kpiLowStockItems', 'warning'],
  ['near_expiry_units', 'dashboardOverview.kpiNearExpiryUnits', 'warning'],
  ['expired_units', 'dashboardOverview.kpiExpiredUnits', 'danger'],
  ['pending_variances', 'dashboardOverview.kpiPendingVariances'],
  ['open_po_lines', 'dashboardOverview.kpiOpenPoLines'],
  ['inbound_expected_units', 'dashboardOverview.kpiInboundExpectedUnits'],
];

export default function OverviewTab() {
  const { t } = useLocale();
  const [days, setDays] = useState(7);
  const state = useDashboardData('/admin/dashboard/overview', days);
  const { warehouseId, data } = state;

  if (!data) return <div><DataState {...state} /></div>;

  const kpis = data.kpis || {};
  const series = data.series || {};
  const statusData = (data.status_breakdown || []).map((r) => ({
    name: t(`status.${r.status}`, r.status),
    count: r.count,
  }));
  const zoneData = (data.stock_by_zone || []).map((r) => ({
    name: r.zone_name || r.zone_code,
    units: r.units,
  }));
  const flow = [
    { key: 'created', name: t('dashboardOverview.seriesOrdersCreated'), data: series.orders_created || [] },
    { key: 'shipped', name: t('dashboardOverview.seriesOrdersShipped'), data: series.orders_shipped || [] },
  ];
  const received = [
    { key: 'received', name: t('dashboardOverview.seriesReceivedUnits'), data: series.received_units || [] },
  ];

  return (
    <div>
      <RangeSelector value={days} onChange={setDays} options={RANGES} />
      <KpiGrid
        items={KPI_DEFS.map(([key, labelKey, tone]) => ({
          key, label: t(labelKey), value: kpis[key], tone,
        }))}
      />
      <div style={CHART_GRID}>
        <ChartPanel title={t('dashboardOverview.chartOrderFlow')} empty={flow.every((s) => s.data.length === 0)}>
          <TimeSeriesChart series={flow} />
        </ChartPanel>
        <ChartPanel title={t('dashboardOverview.chartReceived')} empty={received[0].data.length === 0}>
          <TimeSeriesChart series={received} />
        </ChartPanel>
        <ChartPanel title={t('dashboardOverview.chartStatus')} empty={statusData.length === 0}>
          <BarChartBasic
            data={statusData}
            xKey="name"
            yKey="count"
            name={t('dashboardOverview.kpiOrders')}
            color={SERIES_COLORS[1]}
          />
        </ChartPanel>
        <ChartPanel title={t('dashboardOverview.chartStockByZone')} empty={zoneData.length === 0}>
          <BarChartBasic
            data={zoneData}
            xKey="name"
            yKey="units"
            name={t('dashboardOverview.units')}
            color={SERIES_COLORS[2]}
          />
        </ChartPanel>
      </div>
      <div style={CHART_GRID}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t('dashboardOverview.aiReplenishment')}</div>
          <AiSuggestions
            kind="replenish"
            warehouseId={warehouseId}
            request={() => ({ path: '/admin/ai/replenishment', body: { warehouse_id: warehouseId } })}
          />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t('dashboardOverview.aiExpiry')}</div>
          <AiSuggestions
            kind="expiry"
            warehouseId={warehouseId}
            request={() => ({ path: '/admin/ai/expiry-actions', body: { warehouse_id: warehouseId, days: 30 } })}
          />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t('ai.panelPutaway')}</div>
          <AiSuggestions
            kind="putaway"
            warehouseId={warehouseId}
            request={() => ({ path: '/admin/ai/putaway', body: { warehouse_id: warehouseId } })}
          />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t('ai.panelBackorders')}</div>
          <AiSuggestions
            kind="backorder"
            warehouseId={warehouseId}
            request={() => ({ path: '/admin/ai/backorders', body: { warehouse_id: warehouseId } })}
          />
        </div>
      </div>
    </div>
  );
}
