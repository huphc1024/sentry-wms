import { Tabs } from 'antd';
import PageHeader from '../components/PageHeader.jsx';
import { useLocale } from '../i18n/locale.jsx';
import OverviewTab from './dashboard/OverviewTab.jsx';
import ProductivityTab from './dashboard/ProductivityTab.jsx';
import SalesTab from './dashboard/SalesTab.jsx';

// Dashboard is a thin tab shell. antd Tabs mounts a pane lazily on first
// activation, so Overview and Sales do not fetch until opened. The
// original productivity view (with its Received / Marketplace Health /
// Local Pickup sub-tabs) lives in dashboard/ProductivityTab.jsx.
export default function Dashboard() {
  const { t } = useLocale();
  const items = [
    { key: 'overview', label: t('dashboardOverview.tabOverview'), children: <OverviewTab /> },
    { key: 'productivity', label: t('dashboardOverview.tabProductivity'), children: <ProductivityTab /> },
    { key: 'sales', label: t('dashboardOverview.tabSales'), children: <SalesTab /> },
  ];
  return (
    <div>
      <PageHeader title={t('nav.dashboard')} />
      <Tabs defaultActiveKey="overview" items={items} />
    </div>
  );
}
