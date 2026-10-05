import { useState } from 'react';
import BarChartBasic from '../../components/charts/BarChartBasic.jsx';
import PieChartBasic from '../../components/charts/PieChartBasic.jsx';
import TimeSeriesChart from '../../components/charts/TimeSeriesChart.jsx';
import { useLocale } from '../../i18n/locale.jsx';
import {
  CHART_GRID, ChartPanel, DataState, KpiGrid, RangeSelector, useDashboardData,
} from './shared.jsx';

const RANGES = [7, 14, 30, 90];

const KPI_DEFS = [
  ['revenue', 'dashboardOverview.kpiRevenue'],
  ['orders', 'dashboardOverview.kpiOrders'],
  ['avg_order_value', 'dashboardOverview.kpiAvgOrderValue'],
  ['cancelled_orders', 'dashboardOverview.kpiCancelledOrders', 'danger'],
  ['invoiced', 'dashboardOverview.kpiInvoiced'],
  ['unpaid', 'dashboardOverview.kpiUnpaid', 'warning'],
];

const money = (v) => Number(v ?? 0).toLocaleString();

export default function SalesTab() {
  const { t } = useLocale();
  const [days, setDays] = useState(30);
  const state = useDashboardData('/admin/dashboard/sales', days);
  const { data } = state;
  if (!data) return <div><DataState {...state} /></div>;

  const kpis = data.kpis || {};
  const revenueSeries = [
    { key: 'revenue', name: t('dashboardOverview.kpiRevenue'), data: data.series?.revenue || [] },
  ];
  const channels = (data.by_channel || []).map((c) => ({
    channel: c.channel, orders: c.orders, revenue: c.revenue,
  }));
  const items = data.top_items || [];

  return (
    <div>
      <RangeSelector value={days} onChange={setDays} options={RANGES} />
      <KpiGrid
        items={KPI_DEFS.map(([key, labelKey, tone]) => ({
          key, label: t(labelKey), value: kpis[key], tone,
        }))}
      />
      <div style={CHART_GRID}>
        <ChartPanel title={t('dashboardOverview.chartRevenue')} empty={revenueSeries[0].data.length === 0}>
          <TimeSeriesChart series={revenueSeries} />
        </ChartPanel>
        <ChartPanel title={t('dashboardOverview.chartChannel')} empty={channels.length === 0}>
          {channels.length > 4
            ? <BarChartBasic data={channels} xKey="channel" yKey="revenue" name={t('dashboardOverview.colRevenue')} />
            : <PieChartBasic data={channels} nameKey="channel" valueKey="revenue" />}
        </ChartPanel>
      </div>
      <ChartPanel title={t('dashboardOverview.topItems')} empty={items.length === 0}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('common.sku')}</th>
              <th>{t('dashboardOverview.colItem')}</th>
              <th style={{ textAlign: 'right' }}>{t('common.quantity')}</th>
              <th style={{ textAlign: 'right' }}>{t('dashboardOverview.colRevenue')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.sku}>
                <td className="mono">{i.sku}</td>
                <td>{i.name}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(i.quantity)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(i.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartPanel>
    </div>
  );
}
