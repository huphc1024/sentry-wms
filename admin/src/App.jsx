import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useLocale } from './i18n/locale.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inventory from './pages/Inventory.jsx';
import CycleCounts from './pages/CycleCounts.jsx';
import CycleCountApproval from './pages/CycleCountApproval.jsx';
import Receiving from './pages/Receiving.jsx';
import PurchaseOrders from './pages/PurchaseOrders.jsx';
import SalesOrders from './pages/SalesOrders.jsx';
import PutAway from './pages/PutAway.jsx';
import PickingTickets from './pages/PickingTickets.jsx';
import PickingTicketPrint from './pages/PickingTicketPrint.jsx';
import PickingTicketPrintAll from './pages/PickingTicketPrintAll.jsx';
import PickingBatches from './pages/PickingBatches.jsx';
import Backorders from './pages/Backorders.jsx';
import RMA from './pages/RMA.jsx';
import Returns from './pages/Returns.jsx';
import Refunds from './pages/Refunds.jsx';
import Bins from './pages/Bins.jsx';
import Zones from './pages/Zones.jsx';
import Items from './pages/Items.jsx';
import Vendors from './pages/Vendors.jsx';
import Data from './pages/Data.jsx';
import Warehouses from './pages/Warehouses.jsx';
import Users from './pages/Users.jsx';
import Tokens from './pages/Tokens.jsx';
import InboundActivity from './pages/InboundActivity.jsx';
import ConsumerGroups from './pages/ConsumerGroups.jsx';
import Webhooks from './pages/Webhooks.jsx';
import Channels from './pages/Channels.jsx';
import Notifications from './pages/Notifications.jsx';
import AuditLog from './pages/AuditLog.jsx';
import PreferredBins from './pages/PreferredBins.jsx';
import Settings from './pages/Settings.jsx';
import Imports from './pages/Imports.jsx';
import Integrations from './pages/Integrations.jsx';
import Adjustments from './pages/Adjustments.jsx';
import InterWarehouseTransfers from './pages/InterWarehouseTransfers.jsx';
import TransferOrders from './pages/TransferOrders.jsx';
import POSActivity from './pages/POSActivity.jsx';
import Fraud from './pages/Fraud.jsx';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  // Forced password change: block everything except the change-password
  // page until the server-side flag clears. The /api/auth/me response is
  // the source of truth; flipping the admin UI client-side would not
  // actually let the user past the middleware's 403 anyway.
  if (user.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

export default function App() {
  const { t } = useLocale();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Standalone print views: rendered without the admin Layout
          chrome so they fill the full window and the per-ticket page
          break CSS doesn't have to fight a sidebar/header parent.
          Still gated by ProtectedRoute so auth is required. */}
      <Route
        path="/picking-tickets/print-all"
        element={
          <ProtectedRoute>
            <ErrorBoundary fallbackMessage={t('errors.printAllFailed')}>
              <PickingTicketPrintAll />
            </ErrorBoundary>
          </ProtectedRoute>
        }
      />
      {/* Individual ticket also renders standalone so the operator can
          open it from any list / search surface in a new tab without
          the admin sidebar competing for screen width or breaking the
          per-page print CSS. */}
      <Route
        path="/picking-tickets/:soId/print"
        element={
          <ProtectedRoute>
            <ErrorBoundary fallbackMessage={t('errors.printFailed')}>
              <PickingTicketPrint />
            </ErrorBoundary>
          </ProtectedRoute>
        }
      />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/change-password" element={<ErrorBoundary fallbackMessage={t('errors.changePasswordFailed')}><ChangePassword /></ErrorBoundary>} />
        <Route path="/" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.dashboard') })}><Dashboard /></ErrorBoundary>} />
        <Route path="/inventory" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.inventory') })}><Inventory /></ErrorBoundary>} />
        <Route path="/cycle-counts" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.counts') })}><CycleCounts /></ErrorBoundary>} />
        <Route path="/count-approvals" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.approvals') })}><CycleCountApproval /></ErrorBoundary>} />
        <Route path="/receiving" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.receiving') })}><Receiving /></ErrorBoundary>} />
        <Route path="/purchase-orders" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.purchaseOrders') })}><PurchaseOrders /></ErrorBoundary>} />
        <Route path="/putaway" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.putaway') })}><PutAway /></ErrorBoundary>} />
        <Route path="/sales-orders" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.salesOrders') })}><SalesOrders /></ErrorBoundary>} />
        <Route path="/pos-activity" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.posActivity') })}><POSActivity /></ErrorBoundary>} />
        <Route path="/fraud" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.fraud') })}><Fraud /></ErrorBoundary>} />
        <Route path="/backorders" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.backorders') })}><Backorders /></ErrorBoundary>} />
        <Route path="/returns" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.returns') })}><Returns /></ErrorBoundary>}>
          <Route path="rma" element={<RMA />} />
          <Route path="refunds" element={<Refunds />} />
        </Route>
        <Route path="/rma" element={<Navigate to="/returns/rma" replace />} />
        <Route path="/picking-tickets" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.pickingTickets') })}><PickingTickets /></ErrorBoundary>} />
        {/* The /picking, /packing, /shipping admin pages were retired:
            the workflow lives on the handheld scanners, and the
            admin-side mirrors duplicated state without adding any
            control surface. Sales Orders + Picking Tickets cover the
            supervisor view; Dashboard counts still surface throughput. */}
        <Route path="/picking-batches" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.pickingBatches') })}><PickingBatches /></ErrorBoundary>} />
        <Route path="/items" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.items') })}><Items /></ErrorBoundary>} />
        <Route path="/vendors" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.vendors') })}><Vendors /></ErrorBoundary>} />
        {/* Warehouse-layout pages consolidated under a single /data
            parent with a tab strip. The four old top-level paths
            redirect so existing bookmarks still land in the right tab. */}
        <Route path="/data" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.data') })}><Data /></ErrorBoundary>}>
          <Route path="warehouses" element={<Warehouses />} />
          <Route path="bins" element={<Bins />} />
          <Route path="zones" element={<Zones />} />
          <Route path="preferred-bins" element={<PreferredBins />} />
        </Route>
        <Route path="/warehouses" element={<Navigate to="/data/warehouses" replace />} />
        <Route path="/bins" element={<Navigate to="/data/bins" replace />} />
        <Route path="/zones" element={<Navigate to="/data/zones" replace />} />
        <Route path="/preferred-bins" element={<Navigate to="/data/preferred-bins" replace />} />
        <Route path="/users" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.users') })}><Users /></ErrorBoundary>} />
        <Route path="/api-tokens" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.apiTokens') })}><Tokens /></ErrorBoundary>} />
        <Route path="/inbound" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.inboundActivity') })}><InboundActivity /></ErrorBoundary>} />
        <Route path="/consumer-groups" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.consumerGroups') })}><ConsumerGroups /></ErrorBoundary>} />
        <Route path="/webhooks" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.webhooks') })}><Webhooks /></ErrorBoundary>} />
        <Route path="/channels" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.channels') })}><Channels /></ErrorBoundary>} />
        <Route path="/notifications" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.notifications') })}><Notifications /></ErrorBoundary>} />
        <Route path="/audit-log" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.auditLog') })}><AuditLog /></ErrorBoundary>} />
        <Route path="/settings" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.settings') })}><Settings /></ErrorBoundary>} />
        <Route path="/imports" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.import') })}><Imports /></ErrorBoundary>} />
        <Route path="/integrations" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.integrations') })}><Integrations /></ErrorBoundary>} />
        <Route path="/adjustments" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.adjustments') })}><Adjustments /></ErrorBoundary>} />
        <Route path="/inter-warehouse-transfers" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.transfers') })}><InterWarehouseTransfers /></ErrorBoundary>} />
        <Route path="/transfer-orders" element={<ErrorBoundary fallbackMessage={t('errors.couldNotLoad', { name: t('nav.transferOrders') })}><TransferOrders /></ErrorBoundary>} />
      </Route>
    </Routes>
  );
}
